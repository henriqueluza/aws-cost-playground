import hashlib
import json

from app.model import FreeTier, Price, Tier
from app.render import render_price_file, sha256_hex

LAMBDA = Price(
    sku="lambda-requests",
    description="Requisições",
    unit="request",
    tiers=(Tier(None, "0.0000002"),),
    free_tier=FreeTier("1000000", "lambda-requests"),
)

GOLDEN = """{
  "schemaVersion": 1,
  "service": "lambda",
  "region": "us-east-1",
  "currency": "USD",
  "prices": [
    {
      "sku": "lambda-requests",
      "description": "Requisições",
      "unit": "request",
      "tiers": [
        {
          "upTo": null,
          "unitPrice": "0.0000002"
        }
      ],
      "freeTier": {
        "quantity": "1000000",
        "pool": "lambda-requests"
      }
    }
  ]
}
"""


def test_golden_bytes() -> None:
    assert render_price_file("lambda", "us-east-1", [LAMBDA]) == GOLDEN.encode("utf-8")


def test_prices_sorted_by_sku_regardless_of_input_order() -> None:
    b = Price("b-sku", "B", "GB", (Tier("10", "0.5"), Tier(None, "0.25")), minimum_quantity="0.001")
    a = Price("a-sku", "A", "GB", (Tier(None, "1"),))
    first = render_price_file("s3", "us-east-1", [b, a])
    assert first == render_price_file("s3", "us-east-1", [a, b])
    doc = json.loads(first)
    assert [p["sku"] for p in doc["prices"]] == ["a-sku", "b-sku"]
    assert list(doc["prices"][1]) == [
        "sku",
        "description",
        "unit",
        "tiers",
        "minimumQuantity",
    ]
    assert doc["prices"][1]["minimumQuantity"] == "0.001"


def test_optional_fields_omitted() -> None:
    bare = Price("a", "A", "GB", (Tier(None, "1"),))
    no_pool = Price("b", "B", "GB", (Tier(None, "1"),), free_tier=FreeTier("5"))
    doc = json.loads(render_price_file("s3", "us-east-1", [bare, no_pool]))
    assert list(doc["prices"][0]) == ["sku", "description", "unit", "tiers"]
    assert doc["prices"][1]["freeTier"] == {"quantity": "5"}


def test_empty_prices() -> None:
    doc = json.loads(render_price_file("s3", "sa-east-1", []))
    assert doc["prices"] == []
    assert list(doc) == ["schemaVersion", "service", "region", "currency", "prices"]


def test_sha256_hex() -> None:
    assert sha256_hex(b"") == "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    content = render_price_file("lambda", "us-east-1", [LAMBDA])
    assert sha256_hex(content) == hashlib.sha256(content).hexdigest()
