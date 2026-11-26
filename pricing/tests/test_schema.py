"""Espelha os casos de `web/src/features/pricing/model/catalog.test.ts`."""

from typing import Any

import pytest

from app.schema import (
    MAX_DESCRIPTION,
    MAX_FILES,
    MAX_PRICES,
    MAX_TIERS,
    MAX_UNIT,
    validate_manifest,
    validate_price_file,
)

SHA = "a" * 64
REQUESTS: dict[str, Any] = {
    "sku": "AWS-Lambda-Requests",
    "description": "Requisições",
    "unit": "Requests",
    "tiers": [{"upTo": None, "unitPrice": "0.0000002"}],
    "freeTier": {"quantity": "1000000", "pool": "lambda-requests"},
}
DURATION: dict[str, Any] = {
    "sku": "AWS-Lambda-Duration",
    "description": "Duração (x86)",
    "unit": "GB-Second",
    "tiers": [
        {"upTo": "6000000000", "unitPrice": "0.0000166667"},
        {"upTo": "15000000000", "unitPrice": "0.000015"},
        {"upTo": None, "unitPrice": "0.0000133334"},
    ],
    "minimumQuantity": "0.001",
}
FILE: dict[str, Any] = {
    "schemaVersion": 1,
    "service": "lambda",
    "region": "us-east-1",
    "currency": "USD",
    "prices": [REQUESTS, DURATION],
}
MANIFEST: dict[str, Any] = {
    "schemaVersion": 1,
    "source": "seed",
    "generatedAt": "2026-11-23T12:00:00Z",
    "files": [
        {"path": "us-east-1/lambda.json", "sha256": SHA},
        {"path": "sa-east-1/lambda.json", "sha256": SHA},
    ],
}
BAD_DECIMALS = [
    "0.0000000000001",
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
    "\u0661",
    0.0000002,
    1,
]


def file_with(**patch: object) -> dict[str, Any]:
    return {**FILE, **patch}


def price_with(**patch: object) -> dict[str, Any]:
    return file_with(prices=[{**DURATION, **patch}])


def tiers_of(*up_tos: object) -> dict[str, Any]:
    return price_with(tiers=[{"upTo": up_to, "unitPrice": "1"} for up_to in up_tos])


def ascending(count: int) -> list[object]:
    return [*(str(i + 1) for i in range(count - 1)), None]


def skus(count: int) -> list[dict[str, Any]]:
    return [{**REQUESTS, "sku": f"sku-{i}"} for i in range(count)]


def manifest_with(**patch: object) -> dict[str, Any]:
    return {**MANIFEST, **patch}


def manifest_file(**patch: object) -> dict[str, Any]:
    return manifest_with(files=[{**MANIFEST["files"][0], **patch}])


def without(doc: dict[str, Any], key: str) -> dict[str, Any]:
    return {k: v for k, v in doc.items() if k != key}


@pytest.mark.parametrize(
    "doc",
    [
        FILE,
        file_with(region="sa-east-1"),
        file_with(prices=[]),
        file_with(prices=skus(MAX_PRICES)),
        file_with(futureField=1),
        tiers_of(*ascending(MAX_TIERS)),
        price_with(tiers=[{"upTo": None, "unitPrice": "0"}]),
        price_with(tiers=[{"upTo": None, "unitPrice": "123456789012345.123456789012"}]),
        price_with(freeTier={"quantity": "5"}),
        price_with(description="a" * MAX_DESCRIPTION),
        price_with(description=""),
        price_with(unit="a" * MAX_UNIT),
    ],
)
def test_accepts_price_file(doc: object) -> None:
    assert validate_price_file(doc) == []


@pytest.mark.parametrize("value", [*BAD_DECIMALS, None])
def test_rejects_bad_unit_price(value: object) -> None:
    errors = validate_price_file(price_with(tiers=[{"upTo": None, "unitPrice": value}]))
    assert errors == ["prices[0].tiers[0].unitPrice: decimal fora do formato"]


@pytest.mark.parametrize("value", BAD_DECIMALS)
def test_rejects_bad_quantity(value: object) -> None:
    assert validate_price_file(tiers_of(value, None)) == [
        "prices[0].tiers[0].upTo: decimal fora do formato"
    ]
    assert validate_price_file(price_with(freeTier={"quantity": value})) == [
        "prices[0].freeTier.quantity: decimal fora do formato"
    ]
    assert validate_price_file(price_with(minimumQuantity=value)) == [
        "prices[0].minimumQuantity: decimal fora do formato"
    ]


@pytest.mark.parametrize(
    ("doc", "message"),
    [
        (tiers_of(), "tiers: de 1 a 16 faixas"),
        (tiers_of(*ascending(MAX_TIERS + 1)), "tiers: de 1 a 16 faixas"),
        (price_with(tiers={"upTo": None}), "tiers: de 1 a 16 faixas"),
        (price_with(tiers=["1"]), "tiers[0]: não é objeto"),
        (tiers_of("10", "5", None), "tiers[1].upTo: faixas fora de ordem crescente"),
        (tiers_of("10", "10", None), "tiers[1].upTo: faixas fora de ordem crescente"),
        (tiers_of("0", None), "tiers[0].upTo: faixas fora de ordem crescente"),
        (tiers_of(None, "10", None), "tiers[0].upTo: só a última faixa é aberta"),
        (tiers_of("10", None, None), "tiers[1].upTo: só a última faixa é aberta"),
        (tiers_of("10", "20"), "tiers[1].upTo: a última faixa é aberta"),
        (price_with(sku="a b"), "sku: fora do formato"),
        (price_with(sku="-a"), "sku: fora do formato"),
        (price_with(sku="a" * 65), "sku: fora do formato"),
        (price_with(sku="a\n"), "sku: fora do formato"),
        (price_with(description="a" * (MAX_DESCRIPTION + 1)), "description: texto fora do limite"),
        (price_with(description="😀" * 101), "description: texto fora do limite"),
        (price_with(description=None), "description: texto fora do limite"),
        (price_with(unit=""), "unit: texto fora do limite"),
        (price_with(unit="a" * (MAX_UNIT + 1)), "unit: texto fora do limite"),
        (price_with(freeTier=None), "freeTier: não é objeto"),
        (price_with(freeTier={"quantity": "1", "pool": "A"}), "freeTier.pool: fora do formato"),
        (price_with(freeTier={"quantity": "1", "pool": None}), "freeTier.pool: fora do formato"),
        (price_with(minimumQuantity=None), "minimumQuantity: decimal fora do formato"),
    ],
)
def test_rejects_price(doc: object, message: str) -> None:
    assert validate_price_file(doc) == [f"prices[0].{message}"]


@pytest.mark.parametrize(
    ("doc", "errors"),
    [
        (file_with(schemaVersion=2), ["schemaVersion: deve ser 1"]),
        (file_with(schemaVersion=True), ["schemaVersion: deve ser 1"]),
        (file_with(schemaVersion="1"), ["schemaVersion: deve ser 1"]),
        (file_with(region="eu-west-1"), ["region: fora da lista"]),
        (file_with(region=["us-east-1"]), ["region: fora da lista"]),
        (file_with(currency="BRL"), ["currency: deve ser USD"]),
        (file_with(service="../lambda"), ["service: fora do formato"]),
        (file_with(service="Lambda"), ["service: fora do formato"]),
        (file_with(service="a" * 41), ["service: fora do formato"]),
        (file_with(prices=skus(MAX_PRICES + 1)), ["prices: lista de até 200 preços"]),
        (file_with(prices={}), ["prices: lista de até 200 preços"]),
        (file_with(prices=["x"]), ["prices[0]: não é objeto"]),
        (file_with(prices=[REQUESTS, REQUESTS]), ["prices[1].sku: SKU repetido"]),
        (without(FILE, "prices"), ["prices: lista de até 200 preços"]),
        ([FILE], ["arquivo: não é objeto"]),
        (None, ["arquivo: não é objeto"]),
        (
            {},
            [
                "schemaVersion: deve ser 1",
                "service: fora do formato",
                "region: fora da lista",
                "currency: deve ser USD",
                "prices: lista de até 200 preços",
            ],
        ),
    ],
)
def test_rejects_price_file(doc: object, errors: list[str]) -> None:
    assert validate_price_file(doc) == errors


def test_errors_never_echo_the_value() -> None:
    marker = "VAZOU"
    doc = file_with(
        service=marker,
        region=marker,
        currency=marker,
        prices=[{"sku": f"{marker} ", "description": 1, "unit": "", "tiers": [{"upTo": marker}]}],
    )
    errors = validate_price_file(doc) + validate_manifest(
        manifest_with(source=marker, generatedAt=marker, files=[{"path": marker, "sha256": marker}])
    )
    assert len(errors) == 12
    assert marker not in "".join(errors)


@pytest.mark.parametrize(
    "doc",
    [
        MANIFEST,
        manifest_with(source="price-list"),
        manifest_with(files=[]),
        manifest_with(generatedAt="2026-11-23T12:00:00.123Z"),
        manifest_with(futureField=1),
    ],
)
def test_accepts_manifest(doc: object) -> None:
    assert validate_manifest(doc) == []


@pytest.mark.parametrize(
    "sha256", ["A" * 64, "a" * 63, "a" * 65, "g" * 64, f"sha256:{'a' * 57}", "", None, 1]
)
def test_rejects_sha256(sha256: object) -> None:
    assert validate_manifest(manifest_file(sha256=sha256)) == ["files[0].sha256: fora do formato"]


@pytest.mark.parametrize(
    "path",
    [
        "eu-west-1/lambda.json",
        "lambda.json",
        "us-east-1/../lambda.json",
        "us-east-1/a/lambda.json",
        "/us-east-1/lambda.json",
        "https://example.com/us-east-1/lambda.json",
        "us-east-1/lambda.js",
        "us-east-1/Lambda.json",
        "us-east-1/lambda.json\n",
        None,
    ],
)
def test_rejects_manifest_path(path: object) -> None:
    assert validate_manifest(manifest_file(path=path)) == ["files[0].path: fora do formato"]


@pytest.mark.parametrize(
    ("doc", "errors"),
    [
        (manifest_with(schemaVersion=2), ["schemaVersion: deve ser 1"]),
        (manifest_with(source="manual"), ["source: fora da lista"]),
        (manifest_with(source=["seed"]), ["source: fora da lista"]),
        (without(MANIFEST, "source"), ["source: fora da lista"]),
        (without(MANIFEST, "generatedAt"), ["generatedAt: data fora do formato"]),
        (manifest_with(generatedAt="2026-11-23"), ["generatedAt: data fora do formato"]),
        (manifest_with(generatedAt="2026-11-23T12:00Z"), ["generatedAt: data fora do formato"]),
        (
            manifest_with(generatedAt="2026-11-23T12:00:00-03:00"),
            ["generatedAt: data fora do formato"],
        ),
        (manifest_with(generatedAt="2026-02-30T12:00:00Z"), ["generatedAt: data fora do formato"]),
        (manifest_with(generatedAt="2026-11-23T24:00:00Z"), ["generatedAt: data fora do formato"]),
        (manifest_with(files=[MANIFEST["files"][0]] * 2), ["files[1].path: arquivo repetido"]),
        (
            manifest_with(
                files=[
                    {"path": f"us-east-1/s{i}.json", "sha256": SHA} for i in range(MAX_FILES + 1)
                ]
            ),
            ["files: lista de até 100 arquivos"],
        ),
        (manifest_with(files={"us-east-1/lambda.json": SHA}), ["files: lista de até 100 arquivos"]),
        (manifest_with(files=["us-east-1/lambda.json"]), ["files[0]: não é objeto"]),
        ("manifest", ["manifest: não é objeto"]),
    ],
)
def test_rejects_manifest(doc: object, errors: list[str]) -> None:
    assert validate_manifest(doc) == errors
