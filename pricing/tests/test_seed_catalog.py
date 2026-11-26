"""O catálogo versionado em `web/public/prices/` e o exemplo que o teste do `web/` valida."""

import json
from datetime import UTC, datetime
from pathlib import Path

from app.catalog import MANIFEST, PRICES_DIR
from app.generate import seed
from app.model import FreeTier, Price, Tier
from app.render import render_manifest, render_price_file, sha256_hex
from app.schema import validate_manifest
from app.services import SERVICES

ROOT = Path(__file__).resolve().parents[2]
EXAMPLE = ROOT / "web/src/features/pricing/api/__fixtures__/generator"
HINT = "rode `uv run python -m app seed` em pricing/ e versione o manifest.json"

EXAMPLE_PRICES = (
    Price(
        sku="lambda-requests",
        description="Requisições",
        unit="request",
        tiers=(Tier(None, "0.0000002"),),
        free_tier=FreeTier("1000000", "lambda-requests"),
    ),
    Price(
        sku="lambda-duration-x86",
        description="Duração (x86)",
        unit="GB-second",
        tiers=(
            Tier("6000000000", "0.0000166667"),
            Tier("15000000000", "0.000015"),
            Tier(None, "0.0000133334"),
        ),
        free_tier=FreeTier("400000"),
        minimum_quantity="0.001",
    ),
)


def test_versioned_manifest_matches_the_versioned_files() -> None:
    prices_dir = ROOT / PRICES_DIR
    expected = seed(SERVICES, prices_dir).files[MANIFEST]
    committed = (prices_dir / MANIFEST).read_bytes()
    assert validate_manifest(json.loads(committed)) == []
    assert json.loads(committed)["files"] == json.loads(expected)["files"], HINT
    assert committed == expected or json.loads(committed)["source"] == "price-list", HINT


def test_generator_output_is_the_example_the_web_validates() -> None:
    price_file = render_price_file("lambda", "us-east-1", EXAMPLE_PRICES)
    manifest = render_manifest(
        {"us-east-1/lambda.json": sha256_hex(price_file)}, datetime(2026, 11, 23, 12, tzinfo=UTC)
    )
    hint = "o gerador mudou: atualize o exemplo e confira o teste generatorContract do web/"
    assert (EXAMPLE / "us-east-1/lambda.json").read_bytes() == price_file, hint
    assert (EXAMPLE / MANIFEST).read_bytes() == manifest, hint
