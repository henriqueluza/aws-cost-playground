from pathlib import Path

import pytest

from app.catalog import output_path


def test_output_path() -> None:
    assert output_path(Path("/r"), "sa-east-1", "amazon-s3") == Path(
        "/r/web/public/prices/sa-east-1/amazon-s3.json"
    )


@pytest.mark.parametrize(
    ("region", "service"),
    [("us-east-1", "../x"), ("us-east-1", "S3"), ("us-east-1", ""), ("eu-west-1", "s3")],
)
def test_rejects_invalid(region: str, service: str) -> None:
    with pytest.raises(ValueError, match="inválido"):
        output_path(Path("/r"), region, service)
