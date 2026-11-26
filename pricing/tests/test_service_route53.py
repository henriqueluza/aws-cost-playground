"""Bloco Route 53: consultas, preços a partir da Price List real (fixtures) e a semente versionada.

Fixtures: bulk offer file público da AWS publicado em 18/11/2026 e baixado em 26/11/2026.
"""

import json
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path

import pytest

from app.catalog import PRICES_DIR, file_key
from app.generate import generate
from app.model import Dimension, Filter, Price, PricingError, Product, Query, Tier
from app.products import parse_product
from app.schema import validate_price_file
from app.services.route53 import SERVICE

SEED = Path(__file__).resolve().parents[2] / PRICES_DIR
FIXTURES = Path(__file__).parent / "fixtures"
NOW = datetime(2026, 11, 26, tzinfo=UTC)
REGIONS = ("us-east-1", "sa-east-1")
# Produtos globais (os mesmos nas duas fixtures) e o Resolver regional de cada fixture.
ZONE, QUERIES = "KVPGEJE88UW8S779", "JHRA6QBEDT9FZVT5"
ALIAS, LATENCY = "SJ2RJA9FC4AMHVM9", "K5DP4A2QJU976SZ8"
RESOLVER = {"us-east-1": "UA2M4EHGFQSJQV5S", "sa-east-1": "ZYHB7JMESCJ4VVA5"}
ZONES, DNS = "route53-hosted-zones", "route53-queries"
EXPECTED = (
    Price(ZONES, "Zonas hospedadas", "hosted zone-month", (Tier("25", "0.5"), Tier(None, "0.1"))),
    Price(
        DNS,
        "Consultas DNS padrão",
        "query",
        (Tier("1000000000", "0.0000004"), Tier(None, "0.0000002")),
    ),
)


def _load(region: str) -> list[Product]:
    lines = (FIXTURES / f"route53-{region}.jsonl").read_text(encoding="utf-8").splitlines()
    return [parse_product(line) for line in lines if line]


# O produto global aparece nos dois arquivos; na Price List ele é um só.
PRODUCTS = {p.sku: p for region in REGIONS for p in _load(region)}


def fetch(query: Query) -> list[Product]:
    """Emula o TERM_MATCH do `GetProducts` sobre as fixtures."""
    assert query.service_code == "AmazonRoute53"

    def matches(product: Product, f: Filter) -> bool:
        assert f.type == "TERM_MATCH"
        return product.attributes.get(f.field) == f.value

    return [p for p in PRODUCTS.values() if all(matches(p, f) for f in query.filters)]


def fetched(region: str) -> list[Product]:
    return [p for query in SERVICE.queries(region) for p in fetch(query)]


def attrs(product: Product, **changes: str) -> Product:
    return replace(product, attributes={**product.attributes, **changes})


def no_region(product: Product) -> Product:
    """Mesmo produto global com a chave `regionCode` removida (a AWS às vezes a omite)."""
    kept = {k: v for k, v in product.attributes.items() if k != "regionCode"}
    return replace(product, attributes=kept)


def swap(sku: str, *dimensions: Dimension) -> list[Product]:
    return [replace(p, dimensions=dimensions) if p.sku == sku else p for p in fetched(REGIONS[0])]


@pytest.mark.parametrize("region", REGIONS)
def test_queries_ignore_the_region(region: str) -> None:
    assert SERVICE.queries(region) == (
        Query("AmazonRoute53", (Filter("usagetype", "HostedZone"),)),
        Query("AmazonRoute53", (Filter("usagetype", "DNS-Queries"),)),
    )
    assert (SERVICE.slug, SERVICE.service_code) == ("route53", "AmazonRoute53")
    assert SERVICE.expected_skus == {ZONES, DNS}


@pytest.mark.parametrize("region", REGIONS)
def test_build_takes_only_the_global_closed_set(region: str) -> None:
    # A resposta simulada do filtro traz só a zona e as consultas padrão globais.
    assert sorted(p.sku for p in fetched(region)) == sorted((ZONE, QUERIES))
    assert SERVICE.build(region, fetched(region)) == EXPECTED
    # Alias (grátis), latência e o Resolver das duas regiões ficam fora mesmo se vierem.
    assert {ALIAS, LATENCY, *RESOLVER.values()} <= PRODUCTS.keys()
    assert SERVICE.build(region, list(PRODUCTS.values())) == EXPECTED
    # Faixas iguais nas duas regiões: a fixture da outra região dá o mesmo resultado.
    other = next(r for r in REGIONS if r != region)
    assert SERVICE.build(region, _load(other)) == EXPECTED
    # Sem franquia.
    assert all(p.free_tier is None for p in SERVICE.build(region, fetched(region)))
    assert SERVICE.build(region, []) == ()


@pytest.mark.parametrize("region", REGIONS)
def test_build_skips_regional_products_with_the_same_usagetype(region: str) -> None:
    # Resolver e zona com `regionCode` e o `usagetype` do global: não são o produto global.
    regional = [
        attrs(PRODUCTS[RESOLVER[region]], usagetype="DNS-Queries"),
        attrs(replace(PRODUCTS[ZONE], sku="REGIONAL1"), regionCode=region),
    ]
    assert SERVICE.build(region, [*fetched(region), *regional]) == EXPECTED
    assert SERVICE.build(region, regional) == ()


@pytest.mark.parametrize("region", REGIONS)
def test_build_accepts_global_without_region_code(region: str) -> None:
    assert SERVICE.build(region, [no_region(p) for p in fetched(region)]) == EXPECTED


@pytest.mark.parametrize(("sku", "aws_sku"), [(ZONES, ZONE), (DNS, QUERIES)], ids=[ZONES, DNS])
def test_missing_product_is_left_to_expected_skus(sku: str, aws_sku: str) -> None:
    prices = SERVICE.build(REGIONS[0], [p for p in fetched(REGIONS[0]) if p.sku != aws_sku])
    assert prices == tuple(p for p in EXPECTED if p.sku != sku)


US = fetched(REGIONS[0])
ZONE_1 = Dimension("HostedZone", "0", "25", "0.5")
ZONE_2 = Dimension("HostedZone", "25", None, "0.1")
DNS_1 = Dimension("Queries", "0", "1000000000", "0.0000004")
DNS_2 = Dimension("Queries", "1000000000", None, "0.0000002")
# A consulta alias para recursos da AWS (preço 0) no lugar da consulta padrão.
ALIAS_AS_DNS = attrs(PRODUCTS[ALIAS], usagetype="DNS-Queries")
CASES: dict[str, tuple[list[Product], str]] = {
    "duplicado": (
        [*US, replace(PRODUCTS[QUERIES], sku="OUTRO1")],
        f"mais de um produto da AWS: {DNS}",
    ),
    # Sem `regionCode` também é global: conta como segundo produto.
    "duplicado-sem-regionCode": (
        [*US, no_region(replace(PRODUCTS[ZONE], sku="OUTRO2"))],
        f"mais de um produto da AWS: {ZONES}",
    ),
    "unidade": (
        swap(QUERIES, replace(DNS_1, unit="Query"), replace(DNS_2, unit="Query")),
        f"unidade da AWS inesperada: {DNS}",
    ),
    "unidade-minuscula": (
        swap(ZONE, replace(ZONE_1, unit="hostedzone"), replace(ZONE_2, unit="hostedzone")),
        f"unidade da AWS inesperada: {ZONES}",
    ),
    "unidade-2a-faixa": (
        swap(ZONE, ZONE_1, replace(ZONE_2, unit="Queries")),
        f"unidade da AWS inesperada: {ZONES}",
    ),
    "faixa-0": (
        swap(ZONE, replace(ZONE_1, usd="0"), ZONE_2),
        f"primeira faixa sem preço: {ZONES}",
    ),
    "faixa-0-unica": (
        swap(QUERIES, replace(DNS_1, end=None, usd="0")),
        f"primeira faixa sem preço: {DNS}",
    ),
    "alias-gratis": (
        [*(p for p in US if p.sku != QUERIES), ALIAS_AS_DNS],
        f"primeira faixa sem preço: {DNS}",
    ),
}


@pytest.mark.parametrize(("products", "message"), CASES.values(), ids=CASES)
def test_build_rejects(products: list[Product], message: str) -> None:
    with pytest.raises(PricingError) as info:
        SERVICE.build(REGIONS[0], products)
    # Mensagem fixa e só com o SKU do catálogo: nenhum texto da AWS.
    assert str(info.value) == message


def test_generate_requires_the_global_queries(tmp_path: Path) -> None:
    def resolver_only(query: Query) -> list[Product]:
        # As consultas vêm só do Resolver regional (com `regionCode`), sem o `DNS-Queries` global.
        if Filter("usagetype", "DNS-Queries") in query.filters:
            return [PRODUCTS[sku] for sku in RESOLVER.values()]
        return fetch(query)

    with pytest.raises(PricingError) as info:
        generate([SERVICE], resolver_only, tmp_path, NOW)
    for region in REGIONS:
        assert f"{file_key(region, 'route53')}: SKU esperado ausente: {DNS}" in str(info.value)


@pytest.mark.parametrize("region", REGIONS)
def test_generate_matches_versioned_seed(region: str, tmp_path: Path) -> None:
    result = generate([SERVICE], fetch, tmp_path, NOW)
    produced = json.loads(result.files[file_key(region, "route53")])
    seeded = json.loads((SEED / region / "route53.json").read_bytes())
    assert validate_price_file(seeded) == []
    assert (seeded["service"], seeded["region"]) == ("route53", region)
    assert {p["sku"] for p in seeded["prices"]} == SERVICE.expected_skus
    # Faixas conferidas contra as fixtures: números da AWS que o workflow semanal (#29) atualiza.
    assert [p["tiers"] for p in produced["prices"]] == [
        [{"upTo": t.up_to, "unitPrice": t.unit_price} for t in p.tiers] for p in EXPECTED
    ]
    for price in (*produced["prices"], *seeded["prices"]):
        del price["tiers"]
    # Só `sku`, `description` e `unit` sobram: sem `freeTier` nem `minimumQuantity`.
    rows = [{"sku": p.sku, "description": p.description, "unit": p.unit} for p in EXPECTED]
    assert produced["prices"] == seeded["prices"] == rows
