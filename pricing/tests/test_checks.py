import pytest

from app.checks import (
    MAX_FILE_BYTES,
    NO_COMPARISON,
    blocking,
    parse_price_file,
    regression,
    variation,
)
from app.model import Price, ServiceSpec, Tier
from app.render import render_price_file

SPEC = ServiceSpec(slug="lambda", service_code="AWSLambda", expected_skus=frozenset({"a", "b"}))


def price(sku: str, *unit_prices: str) -> Price:
    last = len(unit_prices) - 1
    tiers = tuple(Tier(None if i == last else str(i + 1), p) for i, p in enumerate(unit_prices))
    return Price(sku=sku, description="d", unit="u", tiers=tiers)


def previous(*prices: Price) -> bytes:
    return render_price_file("lambda", "us-east-1", prices)


def test_blocking_accepts_good_file() -> None:
    prices = [price("a", "1"), price("b", "0")]
    assert blocking(SPEC, prices, previous(*prices)) == []


def test_blocking_lists_every_problem() -> None:
    assert blocking(SPEC, [], b"x" * MAX_FILE_BYTES) == [
        "nenhum preço gerado",
        "SKU esperado ausente: a, b",
        "arquivo de 500 KB ou mais",
    ]
    assert blocking(SPEC, [price("a", "-0.1"), price("b", "1")], b"{}") == ["preço negativo"]
    assert blocking(SPEC, [price("a", "1"), price("b", "1")], b"x" * (MAX_FILE_BYTES - 1)) == []


@pytest.mark.parametrize(
    "content",
    [b"\xff", b"{", b"[" * 100_000, b" " * MAX_FILE_BYTES],
    ids=["utf8", "json", "profundo", "grande"],
)
def test_parse_price_file_rejects(content: bytes) -> None:
    assert parse_price_file(content) is None


@pytest.mark.parametrize("content", [None, b"{", b"[]", b'{"schemaVersion": 2}'])
def test_previous_missing_or_invalid_means_no_comparison(content: bytes | None) -> None:
    assert variation(content, [price("a", "1")]) == [NO_COMPARISON]
    assert regression(content, []) == []


def test_variation_reports_without_blocking() -> None:
    before = previous(
        price("gone", "1"),
        price("same", "1", "2"),
        price("up", "1", "1"),
        price("down", "1"),
        price("edge", "1"),
        price("free", "0", "0"),
        price("shape", "1", "1"),
    )
    after = [
        price("new", "1"),
        price("same", "1", "2"),
        price("up", "1", "1.31"),
        price("down", "0.69"),
        price("edge", "1.3"),
        price("free", "0", "0.1"),
        price("shape", "1"),
    ]
    assert variation(before, after) == [
        "SKU novo: new",
        "SKU removido: gone",
        "variação maior que 30%: down faixa 0",
        "variação maior que 30%: free faixa 1",
        "faixas mudaram: shape",
        "variação maior que 30%: up faixa 1",
    ]
    assert regression(before, after) == []


def test_regression_blocks_broken_answers() -> None:
    before = previous(price("a", "1", "2"), price("b", "0"), price("c", "1"), price("d", "1"))
    assert regression(before, [price("a", "1", "0"), price("b", "0")]) == ["preço zerado: a"]
    assert regression(before, [price("b", "0")]) == [
        "mais da metade dos SKUs do arquivo anterior sumiu"
    ]
