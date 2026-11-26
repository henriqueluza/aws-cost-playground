"""Bloco S3 contra a Price List real: bulk offer file publicado em 25/11/2026, baixado em 26/11."""

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
from app.services.s3 import SERVICE, build, queries

REGIONS = ("us-east-1", "sa-east-1")
FIXTURES = Path(__file__).parent / "fixtures"
SEED = Path(__file__).resolve().parents[2] / PRICES_DIR
STANDARD_US, PUT_US = "WP9ANXZGBYYSGJEA", "E9YHNFENF4XQBZR6"  # SKUs da AWS em us-east-1
PUT, GET = "Requisições PUT, COPY, POST e LIST", "Requisições GET e demais"


def _load(region: str) -> list[Product]:
    lines = (FIXTURES / f"s3-{region}.jsonl").read_text(encoding="utf-8").splitlines()
    return [parse_product(line) for line in lines if line]


# As duas fixtures juntas; cada uma traz ruído real: Annotation e Intelligent-Tiering.
ALL = [p for region in REGIONS for p in _load(region)]


def fetch(query: Query) -> list[Product]:
    """Emula o TERM_MATCH do `GetProducts` sobre as fixtures (as consultas só filtram atributos)."""
    return [p for p in ALL if all(p.attributes.get(f.field) == f.value for f in query.filters)]


def answer(region: str) -> list[Product]:
    return [product for query in queries(region) for product in fetch(query)]


def _expected(low: str, mid: str, high: str, *flat: str) -> tuple[Price, ...]:
    standard = (Tier("51200", low), Tier("512000", mid), Tier(None, high))
    ia, put, get, put_ia, get_ia = ((Tier(None, usd),) for usd in flat)
    return (
        Price("s3-storage-standard", "Armazenamento S3 Standard", "GB-month", standard),
        Price("s3-storage-standard-ia", "Armazenamento S3 Standard-IA", "GB-month", ia),
        Price("s3-requests-put-standard", f"{PUT} (S3 Standard)", "request", put),
        Price("s3-requests-get-standard", f"{GET} (S3 Standard)", "request", get),
        Price("s3-requests-put-standard-ia", f"{PUT} (S3 Standard-IA)", "request", put_ia),
        Price("s3-requests-get-standard-ia", f"{GET} (S3 Standard-IA)", "request", get_ia),
    )


# Standard até 50 TB, até 500 TB e acima; Standard-IA, PUT, GET, PUT-IA e GET-IA sem faixa.
US = ("0.023", "0.022", "0.021", "0.0125", "0.000005", "0.0000004", "0.00001", "0.000001")
SA = ("0.0405", "0.039", "0.037", "0.0221", "0.000007", "0.00000056", "0.00001", "0.000001")
EXPECTED = {"us-east-1": _expected(*US), "sa-east-1": _expected(*SA)}


@pytest.mark.parametrize(("region", "prefix"), [("us-east-1", ""), ("sa-east-1", "SAE1-")])
def test_queries_are_narrow(region: str, prefix: str) -> None:
    storage = ("TimedStorage-ByteHrs", "TimedStorage-SIA-ByteHrs")
    requests = ("Requests-Tier1", "Requests-Tier2", "Requests-SIA-Tier1", "Requests-SIA-Tier2")
    assert queries(region) == tuple(
        Query("AmazonS3", (Filter("regionCode", region), Filter("usagetype", prefix + usagetype)))
        for usagetype in (*storage, *requests)
    )


def test_unknown_region_fails() -> None:
    with pytest.raises(PricingError, match=r"^região sem prefixo de usagetype do S3$"):
        queries("eu-west-1")
    with pytest.raises(PricingError, match=r"^região sem prefixo de usagetype do S3$"):
        build("eu-west-1", ALL)


@pytest.mark.parametrize("region", REGIONS)
def test_build_takes_only_the_closed_set(region: str) -> None:
    assert build(region, answer(region)) == EXPECTED[region]
    assert build(region, ALL) == EXPECTED[region]  # ruído e outra região ficam de fora
    # O armazenamento Standard com outra região, `volumeType` ou família também.
    std = answer(region)[0]
    other = [{**std.attributes, k: "x"} for k in ("regionCode", "volumeType")]
    twins = [replace(std, family="Fee"), *(replace(std, attributes=a) for a in other)]
    assert build(region, [*ALL, *twins]) == EXPECTED[region]


def test_missing_product_is_left_to_expected_skus() -> None:
    prices = build("us-east-1", [p for p in answer("us-east-1") if p.sku != STANDARD_US])
    assert {p.sku for p in prices} == SERVICE.expected_skus - {"s3-storage-standard"}


Change = Callable[[list[Product]], list[Product]]


def _duplicate(ps: list[Product]) -> list[Product]:
    return [*ps, replace(next(p for p in ps if p.sku == STANDARD_US), sku="DUPLICATE1")]


def _put(unit: str, usd: str) -> Change:
    """PUT de us-east-1 com uma faixa só, da unidade e preço dados."""
    dimensions = (Dimension(unit, "0", None, usd),)
    return lambda ps: [replace(p, dimensions=dimensions) if p.sku == PUT_US else p for p in ps]


CASES: dict[str, tuple[Change, str]] = {
    "duplicate": (_duplicate, "mais de um produto da AWS: s3-storage-standard"),
    # Preço por 1.000 requisições: aceitar daria custo 1.000x.
    "unit": (_put("1K Requests", "0.005"), "unidade da AWS inesperada: s3-requests-put-standard"),
    "zero-price": (_put("Requests", "0"), "primeira faixa sem preço: s3-requests-put-standard"),
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
    generated = json.loads(generate([SERVICE], fetch, tmp_path, now).files[f"{region}/s3.json"])
    seed = json.loads((SEED / region / "s3.json").read_bytes())
    assert validate_price_file(generated) == validate_price_file(seed) == []
    assert {p["sku"] for p in seed["prices"]} == SERVICE.expected_skus
    # Sem faixas: números da AWS que o workflow semanal (#29) atualiza.
    for price in (*generated["prices"], *seed["prices"]):
        del price["tiers"]
    assert generated == seed
