"""Bloco DynamoDB: consultas, preços a partir da Price List real (fixtures) e a semente versionada.

Fixtures: bulk offer file público da AWS publicado em 25/11/2026 e baixado em 26/11/2026.
"""

import json
from collections.abc import Callable
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path

import pytest

from app.catalog import PRICES_DIR
from app.generate import generate
from app.model import Dimension, Filter, FreeTier, Price, PricingError, Product, Query, Tier
from app.products import parse_product
from app.schema import validate_price_file
from app.services.dynamodb import SERVICE, build, queries

REGIONS = ("us-east-1", "sa-east-1")
FIXTURES = Path(__file__).parent / "fixtures"
SEED = Path(__file__).resolve().parents[2] / PRICES_DIR
# SKUs da AWS em us-east-1, um por SKU do catálogo.
AWS_SKUS = {
    "dynamodb-read-requests": "4W4ZMC46EHE8XTTZ",
    "dynamodb-write-requests": "FGXVD96DKJMUASY3",
    "dynamodb-read-capacity": "4V475Q49DCKGXQZ2",
    "dynamodb-write-capacity": "R6PXMNYCEDGZ2EYN",
    "dynamodb-storage": "F3E2EDSYC6ZNW7XP",
}
READ_REQ, READ_CAP = AWS_SKUS["dynamodb-read-requests"], AWS_SKUS["dynamodb-read-capacity"]
STORAGE = AWS_SKUS["dynamodb-storage"]


def _load(region: str) -> list[Product]:
    lines = (FIXTURES / f"dynamodb-{region}.jsonl").read_text(encoding="utf-8").splitlines()
    return [parse_product(line) for line in lines if line]


# As duas fixtures juntas, com o ruído (IA, replicadas, PITR, streams).
ALL = [p for region in REGIONS for p in _load(region)]


def fetch(query: Query) -> list[Product]:
    """Emula o TERM_MATCH do `GetProducts` sobre as fixtures."""
    return [p for p in ALL if all(p.attributes.get(f.field) == f.value for f in query.filters)]


def answer(region: str) -> list[Product]:
    return [product for query in queries(region) for product in fetch(query)]


ROWS = (
    ("dynamodb-read-requests", "Leituras sob demanda", "read request unit", None),
    ("dynamodb-write-requests", "Escritas sob demanda", "write request unit", None),
    ("dynamodb-read-capacity", "Capacidade de leitura provisionada", "RCU-hour", "18600"),
    ("dynamodb-write-capacity", "Capacidade de escrita provisionada", "WCU-hour", "18600"),
    ("dynamodb-storage", "Armazenamento (Standard)", "GB-month", "25"),
)
USD = {
    "us-east-1": ("0.000000125", "0.000000625", "0.00013", "0.00065", "0.25"),
    "sa-east-1": ("0.0000001875", "0.0000009375", "0.000195", "0.000975", "0.375"),
}
EXPECTED = {
    region: tuple(
        Price(sku, description, unit, (Tier(None, usd),), FreeTier(free) if free else None)
        for (sku, description, unit, free), usd in zip(ROWS, prices, strict=True)
    )
    for region, prices in USD.items()
}


@pytest.mark.parametrize("region", REGIONS)
def test_queries_are_narrow(region: str) -> None:
    def query(*filters: tuple[str, str]) -> Query:
        narrow = (Filter(field, value) for field, value in filters)
        return Query("AmazonDynamoDB", (Filter("regionCode", region), *narrow))

    read, write = ("group", "DDB-ReadUnits"), ("group", "DDB-WriteUnits")
    on_demand = ("operation", "PayPerRequestThroughput")
    provisioned = ("operation", "CommittedThroughput")
    assert queries(region) == (
        query(read, on_demand),
        query(write, on_demand),
        query(read, provisioned),
        query(write, provisioned),
        query(("volumeType", "Amazon DynamoDB - Indexed DataStore")),
    )


@pytest.mark.parametrize("region", REGIONS)
def test_build_takes_only_the_closed_set(region: str) -> None:
    assert build(region, answer(region)) == EXPECTED[region]
    # Ruído (IA, replicadas, PITR, streams) e produtos da outra região são ignorados.
    assert build(region, ALL) == EXPECTED[region]
    assert build(region, []) == ()


@pytest.mark.parametrize(("sku", "aws_sku"), AWS_SKUS.items(), ids=AWS_SKUS)
def test_missing_product_is_left_to_expected_skus(sku: str, aws_sku: str) -> None:
    prices = build("us-east-1", [p for p in answer("us-east-1") if p.sku != aws_sku])
    assert {p.sku for p in prices} == SERVICE.expected_skus - {sku}


Change = Callable[[list[Product]], list[Product]]


def _dims(sku: str, *dimensions: Dimension) -> Change:
    return lambda ps: [replace(p, dimensions=dimensions) if p.sku == sku else p for p in ps]


def test_free_tier_and_price_come_from_the_price_list() -> None:
    free, paid = Dimension("GB-Mo", "0", "30", "0"), Dimension("GB-Mo", "30", None, "0.3")
    prices = build("us-east-1", _dims(STORAGE, free, paid)(answer("us-east-1")))
    storage = replace(
        EXPECTED["us-east-1"][-1], tiers=(Tier(None, "0.3"),), free_tier=FreeTier("30")
    )
    assert prices == (*EXPECTED["us-east-1"][:-1], storage)


def _duplicate(ps: list[Product]) -> list[Product]:
    return [*ps, replace(next(p for p in ps if p.sku == READ_REQ), sku="DUPLICATE1")]


RR = Dimension("ReadRequestUnits", "0", None, "0.000000125")
RCU_FREE = Dimension("ReadCapacityUnit-Hrs", "0", "18600", "0")
RCU_PAID = Dimension("ReadCapacityUnit-Hrs", "18600", None, "0.00013")
RCU_ONE = replace(RCU_PAID, begin="0")
REQ, CAP = "dynamodb-read-requests", "dynamodb-read-capacity"
FREE = f"franquia ausente ou fora do formato: {CAP}"
WCU = "WriteCapacityUnit-Hrs"

CASES: dict[str, tuple[Change, str]] = {
    "duplicate": (_duplicate, f"mais de um produto da AWS: {REQ}"),
    "unit": (
        _dims(READ_REQ, replace(RR, unit="WriteRequestUnits")),
        f"unidade da AWS inesperada: {REQ}",
    ),
    "unit-capacity": (
        _dims(READ_CAP, replace(RCU_FREE, unit=WCU), replace(RCU_PAID, unit=WCU)),
        f"unidade da AWS inesperada: {CAP}",
    ),
    # Unidade é checada antes do formato da franquia.
    "unit-before-free": (
        _dims(STORAGE, Dimension("ReadCapacityUnit-Hrs", "0", None, "0.25")),
        "unidade da AWS inesperada: dynamodb-storage",
    ),
    "zero-price": (_dims(READ_REQ, replace(RR, usd="0")), f"primeira faixa sem preço: {REQ}"),
    "requests-free-shape": (
        _dims(READ_REQ, replace(RR, end="1000", usd="0"), replace(RR, begin="1000")),
        f"primeira faixa sem preço: {REQ}",
    ),
    "free-1-dim": (_dims(READ_CAP, RCU_ONE), FREE),
    "free-3-dims": (
        _dims(READ_CAP, RCU_FREE, replace(RCU_PAID, end="20000"), replace(RCU_PAID, begin="20000")),
        FREE,
    ),
    "free-first-paid": (_dims(READ_CAP, replace(RCU_FREE, usd="0.0001"), RCU_PAID), FREE),
    "free-second-free": (_dims(READ_CAP, RCU_FREE, replace(RCU_PAID, usd="0")), FREE),
    "free-first-open": (_dims(READ_CAP, replace(RCU_FREE, end=None), RCU_PAID), FREE),
    "free-gap": (_dims(READ_CAP, RCU_FREE, replace(RCU_PAID, begin="20000")), FREE),
    "free-second-closed": (_dims(READ_CAP, RCU_FREE, replace(RCU_PAID, end="20000")), FREE),
    "free-begin": (_dims(READ_CAP, replace(RCU_FREE, begin="1"), RCU_PAID), FREE),
    "storage-1-dim": (
        _dims(STORAGE, Dimension("GB-Mo", "0", None, "0.25")),
        "franquia ausente ou fora do formato: dynamodb-storage",
    ),
}


@pytest.mark.parametrize(("change", "message"), CASES.values(), ids=CASES)
def test_build_rejects_unexpected_shapes(change: Change, message: str) -> None:
    with pytest.raises(PricingError) as info:
        build("us-east-1", change(answer("us-east-1")))
    # Mensagem fixa e só com o SKU do catálogo: nenhum texto da AWS.
    assert str(info.value) == message


@pytest.mark.parametrize("region", REGIONS)
def test_generated_file_matches_the_versioned_seed(region: str, tmp_path: Path) -> None:
    now = datetime(2026, 11, 26, tzinfo=UTC)
    result = generate([SERVICE], fetch, tmp_path, now)
    generated = json.loads(result.files[f"{region}/dynamodb.json"])
    seed = json.loads((SEED / region / "dynamodb.json").read_bytes())
    assert validate_price_file(seed) == []
    assert {p["sku"] for p in seed["prices"]} == SERVICE.expected_skus
    # Sem faixas nem `freeTier.quantity`: números da AWS que o workflow semanal (#29) atualiza.
    # A presença de `freeTier` (e a ausência de `pool`) segue comparada.
    for price in (*generated["prices"], *seed["prices"]):
        del price["tiers"]
        if "freeTier" in price:
            del price["freeTier"]["quantity"]
    assert generated["prices"] == seed["prices"]
