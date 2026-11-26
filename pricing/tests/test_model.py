import dataclasses

import pytest

from app.model import Filter, PricingError, ServiceSpec, decimal_text, region_filter


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("0", "0"),
        ("0.0000002000", "0.0000002"),
        ("6000000000", "6000000000"),
        ("007", "7"),
        ("1.500", "1.5"),
        ("0.000000000000", "0"),
        ("0.0000000000000", "0"),
        ("123456789012345", "123456789012345"),
        ("0.123456789012", "0.123456789012"),
    ],
)
def test_decimal_text_normalizes(raw: str, expected: str) -> None:
    assert decimal_text(raw) == expected


@pytest.mark.parametrize(
    "raw",
    [
        "0.0000000000001",
        "0.0000166666665",
        "1.0000000000001",
        "1e-7",
        "2E3",
        "1234567890123456",
        "-1",
        "+1",
        ".5",
        "1.",
        "0,5",
        "1,000.00",
        " 1",
        "1\n",
        "0x10",
        "NaN",
        "",
        chr(0x661),
        0.0000002,
        None,
    ],
)
def test_decimal_text_rejects(raw: object) -> None:
    with pytest.raises(PricingError):
        decimal_text(raw)


@pytest.mark.parametrize("raw", ["VAZOU", "0.0000000000001"])
def test_decimal_text_error_does_not_echo_input(raw: str) -> None:
    with pytest.raises(PricingError) as err:
        decimal_text(raw)
    assert raw not in str(err.value)


def test_region_filter() -> None:
    assert region_filter("sa-east-1") == Filter("regionCode", "sa-east-1", "TERM_MATCH")


def test_service_spec_defaults_and_frozen() -> None:
    spec = ServiceSpec(slug="x", service_code="Y")
    assert spec.queries("us-east-1") == ()
    assert spec.build("us-east-1", []) == ()
    assert spec.expected_skus == frozenset()
    with pytest.raises(dataclasses.FrozenInstanceError):
        spec.slug = "z"  # type: ignore[misc]
