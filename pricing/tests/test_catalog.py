from pathlib import Path

import pytest

from app.catalog import file_key, output_path


def test_output_path() -> None:
    assert output_path(Path("/r"), "sa-east-1", "amazon-s3") == Path(
        "/r/web/public/prices/sa-east-1/amazon-s3.json"
    )
    assert output_path(Path("/r"), "us-east-1", "a" * 40).name == "a" * 40 + ".json"
    assert file_key("us-east-1", "nat-gateway") == "us-east-1/nat-gateway.json"


@pytest.mark.parametrize(
    ("region", "service"),
    [
        ("us-east-1", "../x"),
        ("us-east-1", "a/b"),
        ("us-east-1", "S3"),
        ("us-east-1", ""),
        ("us-east-1", "s3\n"),
        ("us-east-1", "a" * 41),
        ("us-east-1", "9s"),
        ("us-east-1", "-s"),
        ("eu-west-1", "s3"),
        ("sa-east-1\n", "s3"),
    ],
)
def test_rejects_invalid(region: str, service: str) -> None:
    with pytest.raises(ValueError, match="inválido"):
        output_path(Path("/r"), region, service)
