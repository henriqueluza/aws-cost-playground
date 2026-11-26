from pathlib import Path

import pytest

from app.catalog import output_path


def test_output_path() -> None:
    assert output_path(Path("/r"), "sa-east-1", "amazon-s3") == Path(
        "/r/web/public/prices/sa-east-1/amazon-s3.json"
    )
    assert output_path(Path("/r"), "us-east-1", "a" * 64).name == "a" * 64 + ".json"


@pytest.mark.parametrize(
    ("region", "service"),
    [
        ("us-east-1", "../x"),
        ("us-east-1", "a/b"),
        ("us-east-1", "S3"),
        ("us-east-1", ""),
        ("us-east-1", "s3\n"),
        ("us-east-1", "a" * 65),
        ("eu-west-1", "s3"),
        ("sa-east-1\n", "s3"),
    ],
)
def test_rejects_invalid(region: str, service: str) -> None:
    with pytest.raises(ValueError, match="inválido"):
        output_path(Path("/r"), region, service)
