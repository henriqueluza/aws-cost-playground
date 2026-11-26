"""Bloco Secrets Manager: consultas, preços a partir da Price List real (fixtures) e a semente.

Fixtures: bulk offer file público da AWS publicado em 25/11/2026 e baixado em 26/11/2026.
"""

import json
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path

import pytest

from app.catalog import PRICES_DIR
from app.generate import generate
from app.model import Filter, Price, PricingError, Product, Query, Tier
from app.products import parse_product
from app.schema import validate_price_file
from app.services.secrets_manager import SERVICE

SEED = Path(__file__).resolve().parents[2] / PRICES_DIR
FIXTURES = Path(__file__).parent / "fixtures"
NOW = datetime(2026, 11, 26, tzinfo=UTC)
REGIONS = ("us-east-1", "sa-east-1")
CODE, SECRET, API = "AWSSecretsManager", "AWSSecretsManager-Secret", "AWSSecretsManager-APIRequest"
SECRET_US, API_US = "BJ3PQ9BYGU6P632F", "4MDZ5VNEJPMUTG9B"
SECRETS, REQUESTS = "secrets-manager-secrets", "secrets-manager-api-requests"


def _load(region: str) -> list[Product]:
    lines = (FIXTURES / f"secrets-manager-{region}.jsonl").read_text("utf-8").splitlines()
    return [parse_product(line) for line in lines]


PRODUCTS = {p.sku: p for region in REGIONS for p in _load(region)}
# Mesmo preço nas duas regiões nas fixtures.
EXPECTED = (
    Price(SECRETS, "Segredos armazenados", "secret-month", (Tier(None, "0.4"),)),
    Price(REQUESTS, "Chamadas de API", "request", (Tier(None, "0.000005"),)),
)


def fetch(query: Query) -> list[Product]:
    """Emula o TERM_MATCH do `GetProducts` sobre as fixtures."""
    assert query.service_code == CODE

    def matches(product: Product, f: Filter) -> bool:
        assert f.type == "TERM_MATCH"
        return product.attributes.get(f.field) == f.value

    return [p for p in PRODUCTS.values() if all(matches(p, f) for f in query.filters)]


def fetched(region: str) -> list[Product]:
    return [p for query in SERVICE.queries(region) for p in fetch(query)]


def swap(sku: str, **changes: str) -> list[Product]:
    """Resposta de us-east-1 com as faixas do produto `sku` alteradas."""
    return [
        replace(p, dimensions=tuple(replace(d, **changes) for d in p.dimensions))
        if p.sku == sku
        else p
        for p in fetched(REGIONS[0])
    ]


def test_service() -> None:
    assert (SERVICE.slug, SERVICE.service_code) == ("secrets-manager", CODE)
    assert SERVICE.expected_skus == {SECRETS, REQUESTS}


@pytest.mark.parametrize("region", REGIONS)
def test_queries(region: str) -> None:
    assert SERVICE.queries(region) == tuple(
        Query(CODE, (Filter("regionCode", region), Filter("group", group)))
        for group in (SECRET, API)
    )


@pytest.mark.parametrize("region", REGIONS)
def test_build_from_price_list(region: str) -> None:
    assert {p.attributes["group"] for p in fetched(region)} == {SECRET, API}
    assert SERVICE.build(region, fetched(region)) == EXPECTED
    # A outra região fica fora mesmo se vier na resposta.
    assert SERVICE.build(region, list(PRODUCTS.values())) == EXPECTED
    # SKU sem produto não sai (caso "vazio").
    only_api = [p for p in fetched(region) if p.attributes["group"] == API]
    assert SERVICE.build(region, only_api) == EXPECTED[1:]
    assert SERVICE.build(region, []) == ()


@pytest.mark.parametrize("region", REGIONS)
def test_build_keeps_closed_set(region: str) -> None:
    # Variantes hipotéticas, fora do conjunto fechado de atributos: não entram no arquivo.
    outside = (("group", "AWSSecretsManager-Rotation"), ("regionCode", "eu-west-1"))
    variants = [
        replace(p, sku=f"{p.sku}{n}", attributes={**p.attributes, field: value})
        for p in fetched(region)
        for n, (field, value) in enumerate(outside)
    ]
    assert SERVICE.build(region, [*fetched(region), *variants]) == EXPECTED
    assert SERVICE.build(region, variants) == ()


US = fetched(REGIONS[0])
MORE, UNIT, ZERO = (
    "mais de um produto da AWS",
    "unidade da AWS inesperada",
    "primeira faixa sem preço",
)
CASES: dict[str, tuple[list[Product], str]] = {
    "duplicado-segredo": ([*US, replace(PRODUCTS[SECRET_US], sku="X")], f"{MORE}: {SECRETS}"),
    "duplicado-api": ([*US, replace(PRODUCTS[API_US], sku="X")], f"{MORE}: {REQUESTS}"),
    # Cada SKU só aceita a sua unidade: trocar uma pela outra é recusado.
    "unidade-segredo": (swap(SECRET_US, unit="API Requests"), f"{UNIT}: {SECRETS}"),
    "unidade-api": (swap(API_US, unit="Secrets"), f"{UNIT}: {REQUESTS}"),
    "faixa-0-segredo": (swap(SECRET_US, usd="0"), f"{ZERO}: {SECRETS}"),
    "faixa-0-api": (swap(API_US, usd="0"), f"{ZERO}: {REQUESTS}"),
}


@pytest.mark.parametrize(("products", "message"), CASES.values(), ids=CASES)
def test_build_rejects(products: list[Product], message: str) -> None:
    with pytest.raises(PricingError) as info:
        SERVICE.build(REGIONS[0], products)
    # Mensagem fixa e só com o SKU do catálogo: nenhum texto da AWS.
    assert str(info.value) == message


def test_generate_requires_api_requests(tmp_path: Path) -> None:
    def without_api(query: Query) -> list[Product]:
        return [p for p in fetch(query) if p.attributes["group"] != API]

    with pytest.raises(PricingError, match=f"SKU esperado ausente: {REQUESTS}"):
        generate([SERVICE], without_api, tmp_path, NOW)


@pytest.mark.parametrize("region", REGIONS)
def test_generate_matches_versioned_seed(region: str, tmp_path: Path) -> None:
    key = f"{region}/secrets-manager.json"
    produced = json.loads(generate([SERVICE], fetch, tmp_path, NOW).files[key])
    seeded = json.loads((SEED / key).read_bytes())
    for doc in (produced, seeded):
        assert validate_price_file(doc) == []
        assert (doc["service"], doc["region"]) == ("secrets-manager", region)
    assert {p["sku"] for p in seeded["prices"]} == SERVICE.expected_skus
    # Sem faixas: números da AWS que o workflow semanal (#29) atualiza. Sem franquia.
    for price in (*produced["prices"], *seeded["prices"]):
        assert "freeTier" not in price
        del price["tiers"]
    assert produced["prices"] == seeded["prices"]
