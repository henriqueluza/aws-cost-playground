"""Bloco Cognito: consultas, preços a partir da Price List real (fixtures) e a semente versionada.

Fixtures: bulk offer file público da AWS publicado em 19/11/2026 e baixado em 26/11/2026.
"""

import json
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path

import pytest

from app.catalog import MANIFEST, PRICES_DIR
from app.generate import generate
from app.model import Dimension, Filter, FreeTier, Price, PricingError, Product, Query, Tier
from app.products import parse_product
from app.schema import validate_price_file
from app.services.cognito import SERVICE

SEED = Path(__file__).resolve().parents[2] / PRICES_DIR
FIXTURES = Path(__file__).parent / "fixtures"
NOW = datetime(2026, 11, 26, tzinfo=UTC)
REGIONS = ("us-east-1", "sa-east-1")
CODE, MAU = "AmazonCognito", "CognitoUserPoolsMAU"
OPERATIONS = ("CognitoLiteOperation", "CognitoEssentialsOperation", "CognitoPlusOperation")
# Franquia atual (10 mil MAU) e a do plano legado (50 mil MAU): as duas globais e grátis.
GLOBAL, LEGACY = "AH8UFFURUFH2VCD9", "JRGNUYCVEBKA6U9J"
LITE_US, PLUS_US = "QA55XHQT8NAY3D4U", "KHSYYUADDC9Q7REG"
SKU, FREE = "cognito-mau-lite", "franquia ausente ou fora do formato: cognito-mau"


def _load(region: str) -> list[Product]:
    lines = (FIXTURES / f"cognito-{region}.jsonl").read_text("utf-8").splitlines()
    return [parse_product(line) for line in lines]


# Os produtos globais aparecem nos dois arquivos; na Price List cada um é um só.
PRODUCTS = {p.sku: p for region in REGIONS for p in _load(region)}
LITE, PLUS = PRODUCTS[LITE_US], PRODUCTS[PLUS_US]
NO_REGION = {k: v for k, v in PRODUCTS[GLOBAL].attributes.items() if k != "regionCode"}
POOL = FreeTier("10000", "cognito-mau")
LITE_TIERS = (
    Tier("90000", "0.0055"),
    Tier("990000", "0.0046"),
    Tier("9990000", "0.00325"),
    Tier(None, "0.0025"),
)
FLAT = (Tier(None, "0.015"),)  # Essentials: faixa única.
# Mesmos valores em us-east-1 e sa-east-1 nas fixtures; o Plus não tem franquia.
EXPECTED = (
    Price("cognito-mau-lite", "Usuários ativos mensais (Lite)", "MAU", LITE_TIERS, POOL),
    Price("cognito-mau-essentials", "Usuários ativos mensais (Essentials)", "MAU", FLAT, POOL),
    Price("cognito-mau-plus", "Usuários ativos mensais (Plus)", "MAU", (Tier(None, "0.02"),)),
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


US = fetched(REGIONS[0])


def swap(sku: str, *dimensions: Dimension) -> list[Product]:
    return [replace(p, dimensions=dimensions) if p.sku == sku else p for p in US]


@pytest.mark.parametrize("region", REGIONS)
def test_queries(region: str) -> None:
    assert (SERVICE.slug, SERVICE.service_code) == ("cognito", CODE)
    assert SERVICE.expected_skus == {p.sku for p in EXPECTED}
    regional = tuple(
        Query(CODE, (Filter("regionCode", region), Filter("operation", op))) for op in OPERATIONS
    )
    free = Query(CODE, (Filter("usagetype", "Global-CognitoFreeTierMAU"),))
    assert SERVICE.queries(region) == (*regional, free)


@pytest.mark.parametrize("region", REGIONS)
def test_build_from_price_list(region: str) -> None:
    # A resposta simulada traz só os três planos da região e a franquia (sem `operation`).
    assert sorted(p.attributes["operation"] for p in fetched(region)) == sorted((*OPERATIONS, ""))
    assert PRODUCTS[GLOBAL] in fetched(region)
    assert SERVICE.build(region, fetched(region)) == EXPECTED
    # Distratores reais ficam fora mesmo se vierem na resposta: MAU e franquia legados,
    # Enterprise (regional e Globalv1), MRR, ASF, Bedrock e a outra região.
    assert SERVICE.build(region, list(PRODUCTS.values())) == EXPECTED
    # Sem produto regional não sai preço, mas a franquia segue exigida (caso "vazio").
    assert SERVICE.build(region, [PRODUCTS[GLOBAL]]) == ()


def test_legacy_free_tier_is_not_the_franchise() -> None:
    # Global e grátis como a atual, mas de 0 a 50 mil MAU e do plano antigo.
    legacy = PRODUCTS[LEGACY]
    assert legacy.attributes["regionCode"] == ""
    assert legacy.attributes["usagetype"] == "Global-CognitoUserPoolMAU"
    assert legacy.dimensions == (Dimension(MAU, "0", "50000", "0"),)
    # Junto da atual, não conta como segunda franquia nem troca os 10 mil MAU.
    assert SERVICE.build(REGIONS[0], [*US, legacy]) == EXPECTED
    with pytest.raises(PricingError) as info:
        SERVICE.build(REGIONS[0], [*(p for p in US if p.sku != GLOBAL), legacy])
    assert str(info.value) == FREE


def test_franchise_without_region_code_is_accepted() -> None:
    products = [replace(p, attributes=NO_REGION) if p.sku == GLOBAL else p for p in US]
    assert SERVICE.build(REGIONS[0], products) == EXPECTED


def test_plus_has_no_free_tier() -> None:
    # Lite e Essentials dividem o mesmo pool; o Plus sai sem `free_tier`.
    assert [p.free_tier for p in SERVICE.build(REGIONS[0], US)] == [POOL, POOL, None]
    # SKU sem produto regional não sai; a franquia é exigida mesmo só com o Plus.
    assert SERVICE.build(REGIONS[0], [PLUS, PRODUCTS[GLOBAL]]) == (EXPECTED[2],)


FREE_DIM = Dimension(MAU, "0", "10000", "0")
ZERO = replace(FREE_DIM, end=None)  # Faixa única de 0 ao infinito a preço zero.
REGIONAL = {**PRODUCTS[GLOBAL].attributes, "regionCode": REGIONS[0]}
CASES: dict[str, tuple[list[Product], str]] = {
    "duplicado": ([*US, replace(LITE, sku="OUTRO1")], f"mais de um produto da AWS: {SKU}"),
    "unidade": (
        swap(LITE_US, *(replace(d, unit="Requests") for d in LITE.dimensions)),
        f"unidade da AWS inesperada: {SKU}",
    ),
    "faixa-0": (swap(LITE_US, ZERO), f"primeira faixa sem preço: {SKU}"),
    "vazio": ([], FREE),
    "sem-franquia": ([p for p in US if p.sku != GLOBAL], FREE),
    "so-plus": ([PLUS], FREE),
    "franquia-dupla": ([*US, replace(PRODUCTS[GLOBAL], sku="OUTRO2")], FREE),
    "franquia-regional": (
        [replace(p, attributes=REGIONAL) if p.sku == GLOBAL else p for p in US],
        FREE,
    ),
    "franquia-2": (swap(GLOBAL, FREE_DIM, replace(ZERO, begin="10000")), FREE),
    "franquia-paga": (swap(GLOBAL, replace(FREE_DIM, usd="0.0055")), FREE),
    "inf": (swap(GLOBAL, ZERO), FREE),
    "franquia-inicio": (swap(GLOBAL, replace(FREE_DIM, begin="1")), FREE),
    "franquia-unidade": (swap(GLOBAL, replace(FREE_DIM, unit="Requests")), FREE),
}


@pytest.mark.parametrize(("products", "message"), CASES.values(), ids=CASES)
def test_build_rejects(products: list[Product], message: str) -> None:
    with pytest.raises(PricingError) as info:
        SERVICE.build(REGIONS[0], products)
    # Mensagem fixa e só com o SKU (ou o pool) do catálogo: nenhum texto da AWS.
    assert str(info.value) == message


def test_generate_requires_every_plan(tmp_path: Path) -> None:
    def without_plus(query: Query) -> list[Product]:
        return [p for p in fetch(query) if p.attributes.get("operation") != OPERATIONS[2]]

    with pytest.raises(PricingError, match="SKU esperado ausente: cognito-mau-plus"):
        generate([SERVICE], without_plus, tmp_path, NOW)


@pytest.mark.parametrize("region", REGIONS)
def test_generate_matches_versioned_seed(region: str, tmp_path: Path) -> None:
    files = generate([SERVICE], fetch, tmp_path, NOW).files
    assert set(files) == {MANIFEST, *(f"{r}/cognito.json" for r in REGIONS)}
    produced = json.loads(files[f"{region}/cognito.json"])
    seeded = json.loads((SEED / region / "cognito.json").read_bytes())
    assert validate_price_file(produced) == validate_price_file(seeded) == []
    assert (seeded["service"], seeded["region"]) == ("cognito", region)
    assert {p["sku"] for p in seeded["prices"]} == SERVICE.expected_skus
    # Sem faixas nem `freeTier.quantity`: números da AWS que o workflow semanal (#29) atualiza.
    # A presença de `freeTier` (ausente no Plus) e o `pool` seguem comparados.
    for price in (*produced["prices"], *seeded["prices"]):
        del price["tiers"]
        if "freeTier" in price:
            del price["freeTier"]["quantity"]
    assert produced["prices"] == seeded["prices"]
