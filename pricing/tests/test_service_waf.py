"""Bloco WAF: consultas, preços a partir da Price List real (fixtures) e a semente versionada.

Fixtures: bulk offer file público da AWS publicado em 23/11/2026 e baixado em 26/11/2026.
"""

import json
from collections.abc import Callable
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path

import pytest

from app.catalog import PRICES_DIR
from app.generate import generate
from app.model import Dimension, Filter, Price, PricingError, Product, Query, Tier
from app.products import parse_product
from app.schema import validate_price_file
from app.services.waf import SERVICE, build, queries

REGIONS = ("us-east-1", "sa-east-1")
FIXTURES = Path(__file__).parent / "fixtures"
SEED = Path(__file__).resolve().parents[2] / PRICES_DIR
NOW = datetime(2026, 11, 26, tzinfo=UTC)
ACLS, RULES, REQUESTS = "waf-web-acls", "waf-rules", "waf-requests"
# SKUs da AWS (WAFv2 regional) por região, um por SKU do catálogo, na ordem das consultas.
AWS_SKUS = {
    "us-east-1": {
        ACLS: "KF2QAJUBXF7XNYSM",
        RULES: "JGH3VFMTQFNJUV5W",
        REQUESTS: "94S3KGQ8C7XGQFSJ",
    },
    "sa-east-1": {
        ACLS: "MSDT9GNBX9YAQFVC",
        RULES: "FPQDEVWKYZ25WGTE",
        REQUESTS: "3HMFQCD5KZ36J7DE",
    },
}
US = AWS_SKUS["us-east-1"]
# Ruído que divide `group` com o conjunto fechado (ou é a mesma Web ACL fora da região).
NOISE = {
    "classic-web-acl": "PJQM8PKU9GAJ6WKY",
    "classic-rule": "MMK6882R53ZPMBQG",
    "classic-request": "C342DJPGVP5ZXQCT",
    "tier0": "3T4KMURJGZDP3439",
    "tier2-2000wcu": "NJU3EFP2T59YT7QG",
    "body-32kb": "ANMHSNQ3DA3Z29W4",
    "global-cloudfront": "DYTQ8YBXB7SEXYTZ",
    "outra-regiao": AWS_SKUS["sa-east-1"][ACLS],
}


def _load(region: str) -> list[Product]:
    lines = (FIXTURES / f"waf-{region}.jsonl").read_text(encoding="utf-8").splitlines()
    return [parse_product(line) for line in lines if line]


# As duas fixtures juntas, com o ruído (Classic, Tier0, Tier2, 32 KB, escopo global).
ALL = [p for region in REGIONS for p in _load(region)]
PRODUCTS = {p.sku: p for p in ALL}


def fetch(query: Query) -> list[Product]:
    """Emula o TERM_MATCH do `GetProducts` sobre as fixtures."""
    assert query.service_code == "awswaf"

    def matches(product: Product, f: Filter) -> bool:
        assert f.type == "TERM_MATCH"
        value = product.family if f.field == "productFamily" else product.attributes.get(f.field)
        return value == f.value

    return [p for p in ALL if all(matches(p, f) for f in query.filters)]


def answer(region: str) -> list[Product]:
    return [p for query in queries(region) for p in fetch(query)]


# Mesmos preços nas duas regiões: faixa única e sem franquia.
EXPECTED = (
    Price(ACLS, "Web ACLs", "web ACL-month", (Tier(None, "5"),)),
    Price(RULES, "Regras das web ACLs", "rule-month", (Tier(None, "1"),)),
    Price(REQUESTS, "Requisições inspecionadas", "request", (Tier(None, "0.0000006"),)),
)


def test_service_spec() -> None:
    assert (SERVICE.slug, SERVICE.service_code) == ("waf", "awswaf")
    assert SERVICE.expected_skus == {ACLS, RULES, REQUESTS}


@pytest.mark.parametrize("region", REGIONS)
def test_queries_are_narrow(region: str) -> None:
    def query(group: str, description: str) -> Query:
        narrow = (Filter("group", group), Filter("groupDescription", description))
        return Query("awswaf", (Filter("regionCode", region), *narrow))

    assert queries(region) == (
        query("Web ACL", "Web ACL Activated"),
        query("Rule", "Rule Activated"),
        query("Request", "Request Processed Tier1"),
    )
    # A resposta simulada traz só os três produtos WAFv2 da região, um por consulta.
    assert [p.sku for p in answer(region)] == list(AWS_SKUS[region].values())


@pytest.mark.parametrize("region", REGIONS)
def test_build_takes_only_the_closed_set(region: str) -> None:
    assert build(region, answer(region)) == EXPECTED
    # Classic, Tier0, Tier2, 32 KB, escopo global e a outra região ficam fora mesmo na resposta.
    assert build(region, ALL) == EXPECTED
    assert build(region, [p for p in ALL if p.sku not in AWS_SKUS[region].values()]) == ()
    assert build(region, []) == ()


@pytest.mark.parametrize("aws_sku", NOISE.values(), ids=NOISE)
def test_build_ignores_noise_next_to_the_closed_set(aws_sku: str) -> None:
    assert build("us-east-1", [*answer("us-east-1"), PRODUCTS[aws_sku]]) == EXPECTED


@pytest.mark.parametrize("region", REGIONS)
def test_no_free_tier(region: str) -> None:
    prices = build(region, ALL)
    assert prices
    assert all(p.free_tier is None for p in prices)


@pytest.mark.parametrize("sku", [ACLS, RULES, REQUESTS])
@pytest.mark.parametrize("region", REGIONS)
def test_missing_product_is_left_to_expected_skus(region: str, sku: str) -> None:
    # O Classic do mesmo `group` segue na resposta e não toma o lugar do WAFv2.
    prices = build(region, [p for p in ALL if p.sku != AWS_SKUS[region][sku]])
    assert prices == tuple(p for p in EXPECTED if p.sku != sku)


Change = Callable[[list[Product]], list[Product]]


def _dims(aws_sku: str, *dimensions: Dimension) -> Change:
    return lambda ps: [replace(p, dimensions=dimensions) if p.sku == aws_sku else p for p in ps]


def _duplicate(aws_sku: str) -> Change:
    return lambda ps: [*ps, replace(PRODUCTS[aws_sku], sku="DUPLICATE1")]


(ACL,), (REQ,) = PRODUCTS[US[ACLS]].dimensions, PRODUCTS[US[REQUESTS]].dimensions
# Dimensões reais do Classic: mesmo preço, unidade "month" minúscula.
CLASSIC_ACL = PRODUCTS[NOISE["classic-web-acl"]].dimensions
CLASSIC_RULE = PRODUCTS[NOISE["classic-rule"]].dimensions
UNIT = "unidade da AWS inesperada: {}"
ZERO = "primeira faixa sem preço: {}"

CASES: dict[str, tuple[Change, str]] = {
    **{f"duplicate-{s}": (_duplicate(US[s]), f"mais de um produto da AWS: {s}") for s in US},
    "classic-month-web-acl": (_dims(US[ACLS], *CLASSIC_ACL), UNIT.format(ACLS)),
    "classic-month-rule": (_dims(US[RULES], *CLASSIC_RULE), UNIT.format(RULES)),
    "web-acl-request": (_dims(US[ACLS], replace(ACL, unit="Request")), UNIT.format(ACLS)),
    "request-month": (_dims(US[REQUESTS], replace(REQ, unit="Month")), UNIT.format(REQUESTS)),
    "request-plural": (_dims(US[REQUESTS], replace(REQ, unit="Requests")), UNIT.format(REQUESTS)),
    "zero-web-acl": (_dims(US[ACLS], replace(ACL, usd="0")), ZERO.format(ACLS)),
    "zero-request": (_dims(US[REQUESTS], replace(REQ, usd="0")), ZERO.format(REQUESTS)),
    # Faixa grátis no início seria franquia, que o WAF não tem.
    "free-first-tier": (
        _dims(US[ACLS], replace(ACL, end="1", usd="0"), replace(ACL, begin="1")),
        ZERO.format(ACLS),
    ),
}


@pytest.mark.parametrize(("change", "message"), CASES.values(), ids=CASES)
def test_build_rejects_unexpected_shapes(change: Change, message: str) -> None:
    with pytest.raises(PricingError) as info:
        build("us-east-1", change(answer("us-east-1")))
    # Mensagem fixa e só com o SKU do catálogo: nenhum texto da AWS.
    assert str(info.value) == message


def test_generate_requires_every_sku(tmp_path: Path) -> None:
    rule = {AWS_SKUS[region][RULES] for region in REGIONS}

    def without_rule(query: Query) -> list[Product]:
        return [p for p in fetch(query) if p.sku not in rule]

    with pytest.raises(PricingError) as info:
        generate([SERVICE], without_rule, tmp_path, NOW)
    assert str(info.value).splitlines() == [
        f"{region}/waf.json: SKU esperado ausente: {RULES}" for region in sorted(REGIONS)
    ]


@pytest.mark.parametrize("region", REGIONS)
def test_generated_file_matches_the_versioned_seed(region: str, tmp_path: Path) -> None:
    generated = json.loads(generate([SERVICE], fetch, tmp_path, NOW).files[f"{region}/waf.json"])
    seed = json.loads((SEED / region / "waf.json").read_bytes())
    assert validate_price_file(seed) == []
    assert (seed["service"], seed["region"]) == ("waf", region)
    assert {p["sku"] for p in seed["prices"]} == SERVICE.expected_skus
    # Faixas conferidas contra as fixtures: a faixa única do produto WAFv2 da região.
    for price in generated["prices"]:
        (dimension,) = PRODUCTS[AWS_SKUS[region][price["sku"]]].dimensions
        assert price["tiers"] == [{"upTo": dimension.end, "unitPrice": dimension.usd}]
    # Sem faixas: números da AWS que o workflow semanal (#29) atualiza.
    for price in (*generated["prices"], *seed["prices"]):
        assert "freeTier" not in price
        del price["tiers"]
    assert generated["prices"] == seed["prices"]
