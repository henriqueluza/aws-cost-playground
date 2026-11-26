"""Bloco Lambda: consultas, preços a partir da Price List real (fixtures) e a semente versionada.

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
from app.services.lambda_ import SERVICE, build, queries

REGIONS = ("us-east-1", "sa-east-1")
FIXTURES = Path(__file__).parent / "fixtures"
SEED = Path(__file__).resolve().parents[2] / PRICES_DIR
# SKUs da AWS em us-east-1: requisições x86 (regional) e franquia de requisições (global).
REQ_X86, FREE_REQ = "GU2ZS9HVP6QTQ7KE", "ZQVCC2M69R4S79XS"


def _load(region: str) -> list[Product]:
    lines = (FIXTURES / f"lambda-{region}.jsonl").read_text(encoding="utf-8").splitlines()
    return [parse_product(line) for line in lines if line]


# As duas fixtures juntas; os produtos globais da franquia aparecem nas duas e ficam uma vez.
ALL = list({p.sku: p for region in REGIONS for p in _load(region)}.values())


def fetch(query: Query) -> list[Product]:
    """Emula o TERM_MATCH do `GetProducts` sobre as fixtures."""

    def value(product: Product, field: str) -> str | None:
        return product.family if field == "productFamily" else product.attributes.get(field)

    return [p for p in ALL if all(value(p, f.field) == f.value for f in query.filters)]


def answer(region: str) -> list[Product]:
    return [product for query in queries(region) for product in fetch(query)]


REQUESTS = (Tier(None, "0.0000002"),)
X86 = (
    Tier("6000000000", "0.0000166667"),
    Tier("15000000000", "0.000015"),
    Tier(None, "0.0000133334"),
)
ARM = (
    Tier("7500000000", "0.0000133334"),
    Tier("18750000000", "0.0000120001"),
    Tier(None, "0.0000106667"),
)
FREE_REQUESTS = FreeTier("1000000", "lambda-requests")
FREE_GBS = FreeTier("400000", "lambda-duration")
EXPECTED = (
    Price("lambda-requests-x86", "Requisições (x86)", "request", REQUESTS, FREE_REQUESTS),
    Price("lambda-requests-arm64", "Requisições (arm64)", "request", REQUESTS, FREE_REQUESTS),
    Price("lambda-duration-x86", "Duração (x86)", "GB-second", X86, FREE_GBS),
    Price("lambda-duration-arm64", "Duração (arm64)", "GB-second", ARM, FREE_GBS),
)


@pytest.mark.parametrize("region", REGIONS)
def test_queries_are_narrow(region: str) -> None:
    def query(field: str, value: str, group: str) -> Query:
        return Query("AWSLambda", (Filter(field, value), Filter("group", group)))

    assert queries(region) == (
        query("regionCode", region, "AWS-Lambda-Requests"),
        query("regionCode", region, "AWS-Lambda-Requests-ARM"),
        query("regionCode", region, "AWS-Lambda-Duration"),
        query("regionCode", region, "AWS-Lambda-Duration-ARM"),
        query("usagetype", "Global-Request", "AWS-Lambda-Requests"),
        query("usagetype", "Global-Lambda-GB-Second", "AWS-Lambda-Duration"),
    )


@pytest.mark.parametrize("region", REGIONS)
def test_build_takes_only_the_closed_set(region: str) -> None:
    assert build(region, answer(region)) == EXPECTED
    # Ruído (provisioned, Edge, armazenamento) e produtos da outra região são ignorados.
    assert build(region, ALL) == EXPECTED
    # Sem produto regional não sai preço, mas a franquia segue exigida (caso "empty").
    assert build(region, [p for p in ALL if p.attributes["regionCode"] == ""]) == ()


def test_free_tier_product_may_omit_region_code() -> None:
    def strip(p: Product) -> Product:
        attributes = {k: v for k, v in p.attributes.items() if k != "regionCode"}
        return replace(p, attributes=attributes) if p.attributes["regionCode"] == "" else p

    assert build("us-east-1", [strip(p) for p in answer("us-east-1")]) == EXPECTED


def test_missing_product_is_left_to_expected_skus() -> None:
    prices = build("us-east-1", [p for p in answer("us-east-1") if p.sku != REQ_X86])
    assert {p.sku for p in prices} == SERVICE.expected_skus - {"lambda-requests-x86"}


Change = Callable[[list[Product]], list[Product]]
REQ_DIM = Dimension("Requests", "0", None, "0.0000002")
FREE_DIM = Dimension("Request", "0", "1000000", "0")
SKU, FREE = "lambda-requests-x86", "franquia ausente ou fora do formato: lambda-requests"


def _dims(sku: str, *dimensions: Dimension) -> Change:
    return lambda ps: [replace(p, dimensions=dimensions) if p.sku == sku else p for p in ps]


def _duplicate(ps: list[Product]) -> list[Product]:
    return [*ps, replace(next(p for p in ps if p.sku == REQ_X86), sku="DUPLICATE1")]


CASES: dict[str, tuple[Change, str]] = {
    "duplicate": (_duplicate, f"mais de um produto da AWS: {SKU}"),
    "unit": (_dims(REQ_X86, replace(REQ_DIM, unit="GB")), f"unidade da AWS inesperada: {SKU}"),
    "zero-price": (_dims(REQ_X86, replace(REQ_DIM, usd="0")), f"primeira faixa sem preço: {SKU}"),
    "empty": (lambda ps: [], FREE),
    "no-free": (lambda ps: [p for p in ps if p.sku != FREE_REQ], FREE),
    "free-2-dims": (_dims(FREE_REQ, FREE_DIM, replace(FREE_DIM, begin="1000000", end=None)), FREE),
    "free-paid": (_dims(FREE_REQ, replace(FREE_DIM, usd="0.1")), FREE),
    "free-inf": (_dims(FREE_REQ, replace(FREE_DIM, end=None)), FREE),
    "free-begin": (_dims(FREE_REQ, replace(FREE_DIM, begin="1")), FREE),
    "free-unit": (_dims(FREE_REQ, replace(FREE_DIM, unit="GB-Seconds")), FREE),
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
    generated = json.loads(generate([SERVICE], fetch, tmp_path, now).files[f"{region}/lambda.json"])
    seed = json.loads((SEED / region / "lambda.json").read_bytes())
    assert validate_price_file(seed) == []
    assert {p["sku"] for p in seed["prices"]} == SERVICE.expected_skus
    # Sem faixas nem `freeTier.quantity`: números da AWS que o workflow semanal (#29) atualiza.
    for price in (*generated["prices"], *seed["prices"]):
        del price["tiers"], price["freeTier"]["quantity"]
    assert generated["prices"] == seed["prices"]
