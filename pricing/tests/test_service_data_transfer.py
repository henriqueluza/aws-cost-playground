"""Transferência de dados (#42): consultas, preços a partir da Price List real e a semente.

Fixtures: bulk offer file público da AWS (`AWSDataTransfer`) publicado em 19/11/2026 e baixado em
26/11/2026: os dois produtos da região, os dois globais e ruído (entre regiões e entrada).
"""

import json
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path

import pytest

from app.catalog import PRICES_DIR
from app.generate import generate
from app.model import Dimension, Filter, FreeTier, Price, PricingError, Product, Query, Tier
from app.products import parse_product
from app.schema import validate_price_file
from app.services.data_transfer import SERVICE

SEED = Path(__file__).resolve().parents[2] / PRICES_DIR
FIXTURES = Path(__file__).parent / "fixtures"
NOW = datetime(2026, 11, 26, tzinfo=UTC)
REGIONS = ("us-east-1", "sa-east-1")
OUT, INTER_AZ = "data-transfer-internet-out", "data-transfer-inter-az"
FREE = f"franquia ausente ou fora do formato: {OUT}"
# SKUs da AWS: franquia global de saída, saída e entre zonas de us-east-1.
GLOBAL, OUT_US, INTER_AZ_US = "PB257JUQ8U6E6UPM", "HQEH3ZWJVT46JHRG", "PNUBVW4CPC8XA46W"
# Os produtos globais aparecem nos dois arquivos; na Price List cada um é um só.
PRODUCTS = {
    p.sku: p
    for region in REGIONS
    for p in map(
        parse_product,
        (FIXTURES / f"data-transfer-{region}.jsonl").read_text("utf-8").splitlines(),
    )
}
# Saída para a internet: primeiros 10 TB, até 50 TB, até 150 TB e acima (US$ por GB).
LIMITS = ("10240", "51200", "153600", None)
USD = {
    "us-east-1": ("0.09", "0.085", "0.07", "0.05"),
    "sa-east-1": ("0.15", "0.138", "0.126", "0.114"),
}


def fetch(query: Query) -> list[Product]:
    """Emula o TERM_MATCH do `GetProducts` sobre as fixtures (as consultas só usam atributos)."""
    assert query.service_code == "AWSDataTransfer"
    assert all(f.type == "TERM_MATCH" for f in query.filters)
    return [
        p
        for p in PRODUCTS.values()
        if all(p.attributes.get(f.field) == f.value for f in query.filters)
    ]


def fetched(region: str) -> list[Product]:
    return [p for query in SERVICE.queries(region) for p in fetch(query)]


def expected(region: str) -> tuple[Price, ...]:
    out = tuple(Tier(up_to, usd) for up_to, usd in zip(LIMITS, USD[region], strict=True))
    return (
        Price(OUT, "Saída da região para a internet", "GB", out, FreeTier("100")),
        Price(
            INTER_AZ,
            "Tráfego entre zonas de disponibilidade, por direção",
            "GB",
            (Tier(None, "0.01"),),
        ),
    )


def swap(sku: str, *dimensions: Dimension) -> list[Product]:
    return [replace(p, dimensions=dimensions) if p.sku == sku else p for p in fetched(REGIONS[0])]


def twin(sku: str, **attributes: str) -> Product:
    """Cópia de um produto com outro SKU da AWS e os atributos trocados."""
    product = PRODUCTS[sku]
    return replace(product, sku="GEMEO1", attributes={**product.attributes, **attributes})


@pytest.mark.parametrize("region", REGIONS)
def test_queries(region: str) -> None:
    source = Filter("fromRegionCode", region)
    assert SERVICE.queries(region) == (
        Query(
            "AWSDataTransfer",
            (source, Filter("transferType", "AWS Outbound"), Filter("toLocation", "External")),
        ),
        Query(
            "AWSDataTransfer",
            (source, Filter("transferType", "IntraRegion"), Filter("toRegionCode", region)),
        ),
        Query(
            "AWSDataTransfer",
            (
                Filter("usagetype", "Global-DataTransfer-Out-Bytes"),
                Filter("transferType", "AWS Outbound"),
            ),
        ),
    )


@pytest.mark.parametrize("region", REGIONS)
def test_build_takes_only_the_closed_set(region: str) -> None:
    # A consulta de saída traz só o produto da região; a franquia vem da consulta global.
    assert len(fetched(region)) == 3
    assert SERVICE.build(region, fetched(region)) == expected(region)
    # Pior caso, resposta sem filtro: a outra região, o tráfego entre regiões, a entrada e o
    # produto global de 1 GB entre zonas ficam fora.
    assert SERVICE.build(region, list(PRODUCTS.values())) == expected(region)
    # Sem produto regional não sai preço, mas a franquia segue exigida (caso "vazio").
    assert SERVICE.build(region, [PRODUCTS[GLOBAL]]) == ()


US = fetched(REGIONS[0])
# Gêmeos: um atributo do conjunto fechado (ou a família) trocado por vez não entra no arquivo.
TWINS = [
    twin(OUT_US, transferType="InterRegion Outbound"),
    twin(OUT_US, toLocation="US West (Oregon)"),
    twin(OUT_US, fromRegionCode="eu-west-1"),
    twin(INTER_AZ_US, toRegionCode="us-west-2"),
    twin(INTER_AZ_US, transferType="InterRegion Inbound"),
    replace(twin(OUT_US), family="Fee"),
    replace(twin(GLOBAL), family="Fee"),
    twin(GLOBAL, usagetype="Global-DataTransfer-Regional-Bytes"),
    twin(GLOBAL, transferType="IntraRegion"),
    # Franquia com região de origem é de outro produto: a global é a sem região.
    twin(GLOBAL, fromRegionCode="us-east-1", toLocation="Outro"),
]


@pytest.mark.parametrize("extra", TWINS, ids=range(len(TWINS)))
def test_build_ignores_twins(extra: Product) -> None:
    assert SERVICE.build(REGIONS[0], [*US, extra]) == expected(REGIONS[0])


def test_build_accepts_global_product_without_region_code() -> None:
    bare = {k: v for k, v in PRODUCTS[GLOBAL].attributes.items() if k != "fromRegionCode"}
    products = [replace(p, attributes=bare) if p.sku == GLOBAL else p for p in US]
    assert SERVICE.build(REGIONS[0], products) == expected(REGIONS[0])


FREE_DIM = Dimension("GB", "0", "100", "0")
PAID = Dimension("GB", "0", None, "0.09")
CASES: dict[str, tuple[list[Product], str]] = {
    "duplicado": ([*US, twin(OUT_US)], f"mais de um produto da AWS: {OUT}"),
    "duplicado-az": ([*US, twin(INTER_AZ_US)], f"mais de um produto da AWS: {INTER_AZ}"),
    "unidade": (swap(OUT_US, replace(PAID, unit="GB-Mo")), f"unidade da AWS inesperada: {OUT}"),
    "faixa-0": (
        swap(OUT_US, replace(FREE_DIM, end="1"), replace(PAID, begin="1")),
        f"faixa sem preço: {OUT}",
    ),
    "az-0": (swap(INTER_AZ_US, replace(PAID, usd="0")), f"faixa sem preço: {INTER_AZ}"),
    "vazio": ([], FREE),
    "sem-franquia": ([p for p in US if p.sku != GLOBAL], FREE),
    "franquia-dupla": ([*US, twin(GLOBAL)], FREE),
    "franquia-2-faixas": (swap(GLOBAL, FREE_DIM, replace(PAID, begin="100")), FREE),
    "franquia-paga": (swap(GLOBAL, replace(FREE_DIM, usd="0.01")), FREE),
    "franquia-inf": (swap(GLOBAL, replace(FREE_DIM, end=None)), FREE),
    "franquia-inicio": (swap(GLOBAL, replace(FREE_DIM, begin="1")), FREE),
    "franquia-unidade": (swap(GLOBAL, replace(FREE_DIM, unit="Requests")), FREE),
}


@pytest.mark.parametrize(("products", "message"), CASES.values(), ids=CASES)
def test_build_rejects(products: list[Product], message: str) -> None:
    with pytest.raises(PricingError) as info:
        SERVICE.build(REGIONS[0], products)
    # Mensagem fixa e só com o SKU do catálogo: nenhum texto da AWS.
    assert str(info.value) == message


def test_generate_requires_both_skus(tmp_path: Path) -> None:
    def without_inter_az(query: Query) -> list[Product]:
        return [p for p in fetch(query) if p.attributes["transferType"] != "IntraRegion"]

    with pytest.raises(PricingError, match=f"SKU esperado ausente: {INTER_AZ}"):
        generate([SERVICE], without_inter_az, tmp_path, NOW)


@pytest.mark.parametrize("region", REGIONS)
def test_generate_matches_versioned_seed(region: str, tmp_path: Path) -> None:
    key = f"{region}/data-transfer.json"
    produced = json.loads(generate([SERVICE], fetch, tmp_path, NOW).files[key])
    seeded = json.loads((SEED / region / "data-transfer.json").read_bytes())
    assert validate_price_file(seeded) == []
    assert (seeded["service"], seeded["region"]) == ("data-transfer", region)
    assert {p["sku"] for p in seeded["prices"]} == SERVICE.expected_skus
    # Sem faixas nem `freeTier.quantity`: números da AWS que o workflow semanal (#29) atualiza.
    for price in (*produced["prices"], *seeded["prices"]):
        del price["tiers"]
        price.get("freeTier", {}).pop("quantity", None)
    assert produced["prices"] == seeded["prices"]
