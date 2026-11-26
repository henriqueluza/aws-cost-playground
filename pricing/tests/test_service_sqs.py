import json
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path

import pytest

from app.generate import generate
from app.model import Dimension, Filter, FreeTier, Price, PricingError, Product, Query, Tier
from app.products import parse_product
from app.schema import validate_price_file
from app.services.sqs import SERVICE

SEED = Path(__file__).resolve().parents[2] / "web/public/prices"
FIXTURES = Path(__file__).parent / "fixtures"
NOW = datetime(2026, 11, 26, tzinfo=UTC)
REGIONS = ("us-east-1", "sa-east-1")
FIFO = "FIFO (first-in, first-out)"
GLOBAL, STANDARD_US = "MNCJEPJRCSC9RFY2", "8RN6B8U4MERHRXP3"
# O produto global aparece nos dois arquivos; na Price List ele é um só.
PRODUCTS = {
    p.sku: p
    for region in REGIONS
    for p in map(parse_product, (FIXTURES / f"sqs-{region}.jsonl").read_text("utf-8").splitlines())
}
STANDARD = PRODUCTS[STANDARD_US]
NO_REGION = {k: v for k, v in PRODUCTS[GLOBAL].attributes.items() if k != "regionCode"}
# Preços das faixas (padrão, FIFO) no bulk offer file de 26/11/2026.
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


def free(end: str | None, usd: str = "0") -> Dimension:
    return Dimension("Requests", "0", end, usd)


@pytest.mark.parametrize("region", REGIONS)
def test_queries(region: str) -> None:
    assert SERVICE.queries(region) == (
        Query("AWSQueueService", (Filter("regionCode", region), Filter("queueType", "Standard"))),
        Query("AWSQueueService", (Filter("regionCode", region), Filter("queueType", FIFO))),
        Query("AWSQueueService", (Filter("usagetype", "Global-Requests"),)),
    )


@pytest.mark.parametrize("region", REGIONS)
def test_build_from_price_list(region: str) -> None:
    assert {p.attributes["queueType"] for p in fetched(region)} == {"Standard", FIFO, "Any"}
    assert SERVICE.build(region, fetched(region)) == expected(region)
    # Fair e a outra região ficam fora mesmo se vierem na resposta.
    assert SERVICE.build(region, list(PRODUCTS.values())) == expected(region)


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


@pytest.mark.parametrize(
    ("products", "message"),
    [
        ([*fetched(REGIONS[0]), replace(STANDARD, sku="OUTRO1")], "mais de um produto"),
        (swap(STANDARD_US, *(replace(d, unit="GB") for d in STANDARD.dimensions)), "unidade"),
        (
            swap(STANDARD_US, replace(STANDARD.dimensions[0], usd="0"), *STANDARD.dimensions[1:]),
            "primeira faixa com preço zero em sqs-requests-standard",
        ),
        ([p for p in fetched(REGIONS[0]) if p.sku != GLOBAL], "franquia"),
        (swap(GLOBAL, free("1000000"), Dimension("Requests", "1000000", None, "0")), "franquia"),
        (swap(GLOBAL, free("1000000", "0.0000001")), "franquia"),
        (swap(GLOBAL, free(None)), "franquia"),
    ],
    ids=["duplicado", "unidade", "faixa-0", "sem-franquia", "franquia-2", "franquia-paga", "inf"],
)
def test_build_rejects(products: list[Product], message: str) -> None:
    with pytest.raises(PricingError, match=message):
        SERVICE.build(REGIONS[0], products)


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
    # Sem `tiers`: o workflow semanal atualiza os preços da semente.
    keys = ("sku", "description", "unit", "freeTier")
    assert [{k: p[k] for k in keys} for p in produced["prices"]] == [
        {k: p[k] for k in keys} for p in seeded["prices"]
    ]
