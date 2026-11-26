"""Bloco SQS: consultas, preços a partir da Price List real (fixtures) e a semente versionada.

Fixtures: bulk offer file público da AWS publicado em 25/11/2026 e baixado em 26/11/2026.
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
from app.services.sqs import SERVICE

SEED = Path(__file__).resolve().parents[2] / PRICES_DIR
FIXTURES = Path(__file__).parent / "fixtures"
NOW = datetime(2026, 11, 26, tzinfo=UTC)
REGIONS = ("us-east-1", "sa-east-1")
FIFO = "FIFO (first-in, first-out)"
GLOBAL, STANDARD_US = "MNCJEPJRCSC9RFY2", "8RN6B8U4MERHRXP3"
SKU, FREE = "sqs-requests-standard", "franquia ausente ou fora do formato: sqs-requests"
# O produto global aparece nos dois arquivos; na Price List ele é um só.
PRODUCTS = {
    p.sku: p
    for region in REGIONS
    for p in map(parse_product, (FIXTURES / f"sqs-{region}.jsonl").read_text("utf-8").splitlines())
}
STANDARD = PRODUCTS[STANDARD_US]
NO_REGION = {k: v for k, v in PRODUCTS[GLOBAL].attributes.items() if k != "regionCode"}
# Preços das faixas (padrão, FIFO) nas fixtures.
USD = {
    "us-east-1": (
        ("0.0000004", "0.0000003", "0.00000024"),
        ("0.0000005", "0.0000004", "0.00000035"),
    ),
    "sa-east-1": (
        ("0.0000004", "0.00000039", "0.00000038"),
        ("0.0000005", "0.00000049", "0.00000048"),
    ),
}


def fetch(query: Query) -> list[Product]:
    """Emula o TERM_MATCH do `GetProducts` sobre as fixtures."""
    assert query.service_code == "AWSQueueService"

    def matches(product: Product, f: Filter) -> bool:
        assert f.type == "TERM_MATCH"
        value = product.family if f.field == "productFamily" else product.attributes.get(f.field)
        return value == f.value

    return [p for p in PRODUCTS.values() if all(matches(p, f) for f in query.filters)]


def fetched(region: str) -> list[Product]:
    return [p for query in SERVICE.queries(region) for p in fetch(query)]


def expected(region: str) -> tuple[Price, ...]:
    free = FreeTier("1000000", "sqs-requests")
    standard, fifo = (
        (Tier("100000000000", a), Tier("200000000000", b), Tier(None, c)) for a, b, c in USD[region]
    )
    return (
        Price("sqs-requests-standard", "Requisições (fila padrão)", "request", standard, free),
        Price("sqs-requests-fifo", "Requisições (fila FIFO)", "request", fifo, free),
    )


def swap(sku: str, *dimensions: Dimension) -> list[Product]:
    return [replace(p, dimensions=dimensions) if p.sku == sku else p for p in fetched(REGIONS[0])]


@pytest.mark.parametrize("region", REGIONS)
def test_queries(region: str) -> None:
    franchise = (Filter("usagetype", "Global-Requests"), Filter("group", "SQS-APIRequest-Tier1"))
    assert SERVICE.queries(region) == (
        Query("AWSQueueService", (Filter("regionCode", region), Filter("queueType", "Standard"))),
        Query("AWSQueueService", (Filter("regionCode", region), Filter("queueType", FIFO))),
        Query("AWSQueueService", franchise),
    )


@pytest.mark.parametrize("region", REGIONS)
def test_build_from_price_list(region: str) -> None:
    assert {p.attributes["queueType"] for p in fetched(region)} == {"Standard", FIFO, "Any"}
    assert SERVICE.build(region, fetched(region)) == expected(region)
    # Fair e a outra região ficam fora mesmo se vierem na resposta.
    assert SERVICE.build(region, list(PRODUCTS.values())) == expected(region)
    # Sem produto regional não sai preço, mas a franquia segue exigida (caso "vazio").
    assert SERVICE.build(region, [PRODUCTS[GLOBAL]]) == ()


@pytest.mark.parametrize(
    "products",
    [
        swap(STANDARD_US, *(replace(d, unit="Request") for d in STANDARD.dimensions)),
        [replace(p, attributes=NO_REGION) if p.sku == GLOBAL else p for p in fetched(REGIONS[0])],
    ],
    ids=["unidade-singular", "franquia-sem-regionCode"],
)
def test_build_accepts_aws_variants(products: list[Product]) -> None:
    assert SERVICE.build(REGIONS[0], products) == expected(REGIONS[0])


US, FREE_DIM = fetched(REGIONS[0]), Dimension("Requests", "0", "1000000", "0")
ZERO = replace(FREE_DIM, end=None)  # Faixa única de 0 ao infinito a preço zero.
CASES: dict[str, tuple[list[Product], str]] = {
    "duplicado": ([*US, replace(STANDARD, sku="OUTRO1")], f"mais de um produto da AWS: {SKU}"),
    "unidade": (swap(STANDARD_US, replace(ZERO, unit="GB")), f"unidade da AWS inesperada: {SKU}"),
    "faixa-0": (swap(STANDARD_US, ZERO), f"primeira faixa sem preço: {SKU}"),
    "vazio": ([], FREE),
    "sem-franquia": ([p for p in US if p.sku != GLOBAL], FREE),
    "franquia-2": (swap(GLOBAL, FREE_DIM, replace(ZERO, begin="1000000")), FREE),
    "franquia-paga": (swap(GLOBAL, replace(FREE_DIM, usd="0.0000001")), FREE),
    "inf": (swap(GLOBAL, ZERO), FREE),
    "franquia-inicio": (swap(GLOBAL, replace(FREE_DIM, begin="1")), FREE),
    "franquia-unidade": (swap(GLOBAL, replace(FREE_DIM, unit="GB")), FREE),
}


@pytest.mark.parametrize(("products", "message"), CASES.values(), ids=CASES)
def test_build_rejects(products: list[Product], message: str) -> None:
    with pytest.raises(PricingError) as info:
        SERVICE.build(REGIONS[0], products)
    # Mensagem fixa e só com o SKU (ou o pool) do catálogo: nenhum texto da AWS.
    assert str(info.value) == message


def test_generate_requires_both_queue_types(tmp_path: Path) -> None:
    def without_fifo(query: Query) -> list[Product]:
        return [p for p in fetch(query) if p.attributes["queueType"] != FIFO]

    with pytest.raises(PricingError, match="SKU esperado ausente: sqs-requests-fifo"):
        generate([SERVICE], without_fifo, tmp_path, NOW)


@pytest.mark.parametrize("region", REGIONS)
def test_generate_matches_versioned_seed(region: str, tmp_path: Path) -> None:
    produced = json.loads(generate([SERVICE], fetch, tmp_path, NOW).files[f"{region}/sqs.json"])
    seeded = json.loads((SEED / region / "sqs.json").read_bytes())
    assert validate_price_file(seeded) == []
    assert (seeded["service"], seeded["region"]) == ("sqs", region)
    assert {p["sku"] for p in seeded["prices"]} == SERVICE.expected_skus
    # Sem faixas nem `freeTier.quantity`: números da AWS que o workflow semanal (#29) atualiza.
    for price in (*produced["prices"], *seeded["prices"]):
        del price["tiers"], price["freeTier"]["quantity"]
    assert produced["prices"] == seeded["prices"]
