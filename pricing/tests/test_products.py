import copy
import json
from typing import Any

import pytest

from app.model import Dimension, PricingError, Tier
from app.products import parse_product, tiers

_DIM = {
    "unit": "Requests",
    "beginRange": "0",
    "endRange": "Inf",
    "pricePerUnit": {"USD": "0.0000002000"},
    "description": "x",
}
_BASE: dict[str, Any] = {
    "product": {
        "sku": "ABC123",
        "productFamily": "Serverless",
        "attributes": {"regionCode": "us-east-1", "group": "AWS-Lambda-Requests"},
    },
    "serviceCode": "AWSLambda",
    "terms": {
        "OnDemand": {"ABC123.T1": {"priceDimensions": {"ABC123.T1.R1": _DIM}}},
        "Reserved": {"qualquer": "coisa"},
    },
}


def item(**patch: Any) -> str:
    """Item válido; `patch` troca chaves de topo (valor `...` remove a chave)."""
    data = copy.deepcopy(_BASE)
    for key, value in patch.items():
        if value is ...:
            data.pop(key)
        else:
            data[key] = value
    return json.dumps(data)


def with_dims(*dims: dict[str, Any]) -> str:
    dimensions = {f"D{i}": d for i, d in enumerate(dims)}
    return item(terms={"OnDemand": {"T": {"priceDimensions": dimensions}}})


def dim(**patch: Any) -> dict[str, Any]:
    data = copy.deepcopy(_DIM)
    for key, value in patch.items():
        if value is ...:
            data.pop(key)
        else:
            data[key] = value
    return data


def prod(**patch: Any) -> dict[str, Any]:
    merged = {**_BASE["product"], **patch}
    return {k: v for k, v in merged.items() if v is not ...}


def d(begin: str, end: str | None, unit: str = "u", usd: str = "1") -> Dimension:
    return Dimension(unit, begin, end, usd)


def test_parse_happy_path_ignores_reserved() -> None:
    p = parse_product(item())
    assert (p.sku, p.family) == ("ABC123", "Serverless")
    assert dict(p.attributes) == {"regionCode": "us-east-1", "group": "AWS-Lambda-Requests"}
    assert p.dimensions == (Dimension("Requests", "0", None, "0.0000002"),)


def test_parse_orders_dimensions_by_begin() -> None:
    high = dim(beginRange="6000000000", pricePerUnit={"USD": "0.0000150000"})
    low = dim(endRange="6000000000", pricePerUnit={"USD": "0.0000166667"})
    p = parse_product(with_dims(high, low))
    assert [(x.begin, x.end, x.usd) for x in p.dimensions] == [
        ("0", "6000000000", "0.0000166667"),
        ("6000000000", None, "0.000015"),
    ]


@pytest.mark.parametrize("terms", [..., {}, {"OnDemand": {}}])
def test_parse_without_ondemand_has_no_dimensions(terms: Any) -> None:
    assert parse_product(item(terms=terms)).dimensions == ()


def test_parse_optional_fields_default() -> None:
    p = parse_product(item(product={"sku": "A1"}))
    assert p.family == ""
    assert dict(p.attributes) == {}


def test_attributes_are_immutable() -> None:
    p = parse_product(item())
    with pytest.raises(TypeError):
        p.attributes["x"] = "y"  # type: ignore[index]


def terms_of(**term: Any) -> dict[str, Any]:
    return {"OnDemand": {"T": term}}


@pytest.mark.parametrize(
    "raw",
    [
        b"{}",
        None,
        {"product": {}},
        "x" * 200_001,
        "{",
        "[" * 100_000,
        "[]",
        item(product=...),
        item(product=[]),
        item(product=prod(sku=...)),
        *(item(product=prod(sku=s)) for s in ("a-b", "a b", "", "a" * 65, 7)),
        item(product=prod(productFamily=3)),
        item(product=prod(productFamily="f" * 129)),
        item(product=prod(attributes={"x": 1})),
        item(terms=[]),
        item(terms={"OnDemand": []}),
        item(terms={"OnDemand": {"A": {"priceDimensions": {}}, "B": {"priceDimensions": {}}}}),
        item(terms=terms_of()),
        *(with_dims(dim(**{k: v})) for k, v in {"unit": ..., "beginRange": ...}.items()),
        *(with_dims(dim(unit=u)) for u in ("", "u" * 65)),
        with_dims(dim(pricePerUnit=...)),
        with_dims(dim(pricePerUnit={})),
        *(with_dims(dim(pricePerUnit={"USD": v})) for v in ("-0.1", "1e-7", 0.1)),
        with_dims(dim(beginRange="5", endRange="5")),
        with_dims(dim(beginRange="5", endRange="3")),
    ],
    ids=lambda v: str(v)[:40],
)
def test_parse_rejects(raw: Any) -> None:
    with pytest.raises(PricingError):
        parse_product(raw)


def test_parse_error_does_not_leak_input() -> None:
    bad_usd = with_dims(dim(pricePerUnit={"USD": "VAZOU"}))
    bad_attr = item(product=prod(attributes={"VAZOU": 1}))
    for raw in (bad_usd, bad_attr):
        with pytest.raises(PricingError) as info:
            parse_product(raw)
        assert "VAZOU" not in str(info.value)


def test_tiers_single_open() -> None:
    assert tiers([d("0", None, usd="0.5")]) == (Tier(None, "0.5"),)


def test_tiers_orders_contiguous() -> None:
    assert tiers([d("10", None, usd="2"), d("0", "10", usd="3")]) == (
        Tier("10", "3"),
        Tier(None, "2"),
    )


def test_tiers_limit_is_16() -> None:
    def chain(n: int) -> list[Dimension]:
        return [d(str(i), str(i + 1) if i < n - 1 else None) for i in range(n)]

    assert len(tiers(chain(16))) == 16
    with pytest.raises(PricingError):
        tiers(chain(17))


@pytest.mark.parametrize(
    "dims",
    [
        [],
        [d("1", None)],
        [d("0", "10"), d("20", None)],
        [d("0", "10"), d("5", None)],
        [d("0", None), d("5", None)],
        [d("0", "10")],
        [d("0", "10", unit="a"), d("10", None, unit="b")],
    ],
    ids=["empty", "start", "gap", "overlap", "two-open", "closed-last", "units"],
)
def test_tiers_rejects(dims: list[Dimension]) -> None:
    with pytest.raises(PricingError):
        tiers(dims)
