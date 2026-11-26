"""Bloco CodePipeline: consultas, preços da Price List real (fixtures) e a semente versionada.

Fixtures: bulk offer file público da AWS publicado em 11/09/2026 e baixado em 26/11/2026.
"""

import json
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path

import pytest

from app.catalog import PRICES_DIR
from app.generate import generate
from app.model import Dimension, Filter, FreeTier, Price, PricingError, Product, Query, Tier
from app.products import parse_product
from app.schema import validate_price_file
from app.services.codepipeline import SERVICE

SEED = Path(__file__).resolve().parents[2] / PRICES_DIR
FIXTURES = Path(__file__).parent / "fixtures"
NOW = datetime(2026, 11, 26, tzinfo=UTC)
REGIONS = ("us-east-1", "sa-east-1")
PREFIX = {"us-east-1": "USE1-", "sa-east-1": "SAE1-"}
ACTIVE, MINUTES = "codepipeline-active-pipelines", "codepipeline-action-minutes"
# SKUs da AWS em us-east-1 (o trial é "Active Pipeline" a preço zero) e os 2 globais da franquia.
ACTIVE_US, MINUTES_US, TRIAL_US = "TD9KXBWATDCHXY5Z", "DJWUTK2Q4VSYNRHG", "VXNDVJE8HG8SJE8X"
FREE_ACTIVE, FREE_MINUTES = "XFZ7BBUMJGQAAN5W", "8FMDH7HG6QN4E65Z"
# Os produtos globais aparecem nos dois arquivos; na Price List cada um é um só.
PRODUCTS = {
    p.sku: p
    for region in REGIONS
    for p in map(
        parse_product, (FIXTURES / f"codepipeline-{region}.jsonl").read_text("utf-8").splitlines()
    )
}
# Mesmos preços e franquias nas duas regiões.
EXPECTED = (
    Price(ACTIVE, "Pipelines ativos (V1)", "pipeline-month", (Tier(None, "1"),), FreeTier("1")),
    Price(
        MINUTES,
        "Minutos de execução de ações (V2)",
        "minute",
        (Tier(None, "0.002"),),
        FreeTier("100"),
    ),
)


def fetch(query: Query) -> list[Product]:
    """Emula o TERM_MATCH do `GetProducts` sobre as fixtures."""
    assert query.service_code == "AWSCodePipeline"

    def matches(product: Product, f: Filter) -> bool:
        assert f.type == "TERM_MATCH"
        value = product.family if f.field == "productFamily" else product.attributes.get(f.field)
        return value == f.value

    return [p for p in PRODUCTS.values() if all(matches(p, f) for f in query.filters)]


def fetched(region: str) -> list[Product]:
    return [p for query in SERVICE.queries(region) for p in fetch(query)]


def swap(sku: str, *dimensions: Dimension) -> list[Product]:
    return [replace(p, dimensions=dimensions) if p.sku == sku else p for p in fetched(REGIONS[0])]


def without_region(sku: str) -> list[Product]:
    """Produto global com a chave `regionCode` ausente, e não vazia."""
    return [
        replace(p, attributes={k: v for k, v in p.attributes.items() if k != "regionCode"})
        if p.sku == sku
        else p
        for p in fetched(REGIONS[0])
    ]


@pytest.mark.parametrize("region", REGIONS)
def test_queries(region: str) -> None:
    active, minutes = (
        (Filter("regionCode", region), Filter("usagetype", PREFIX[region] + suffix))
        for suffix in ("activePipeline", "actionExecutionMinute")
    )
    assert SERVICE.queries(region) == (
        Query("AWSCodePipeline", active),
        Query("AWSCodePipeline", minutes),
        Query("AWSCodePipeline", (Filter("usagetype", "Global-activePipeline"),)),
        Query("AWSCodePipeline", (Filter("usagetype", "Global-actionExecutionMinute"),)),
    )


@pytest.mark.parametrize("region", REGIONS)
def test_build_from_price_list(region: str) -> None:
    assert {p.attributes["usagetype"] for p in fetched(region)} == {
        PREFIX[region] + "activePipeline",
        PREFIX[region] + "actionExecutionMinute",
        "Global-activePipeline",
        "Global-actionExecutionMinute",
    }
    assert SERVICE.build(region, fetched(region)) == EXPECTED
    # O trialPipeline (preço 0) e a outra região ficam fora mesmo se vierem na resposta.
    assert TRIAL_US in PRODUCTS
    assert SERVICE.build(region, list(PRODUCTS.values())) == EXPECTED
    # Sem produto regional não sai preço, mas as franquias seguem exigidas (caso "vazio").
    assert SERVICE.build(region, [PRODUCTS[FREE_ACTIVE], PRODUCTS[FREE_MINUTES]]) == ()


@pytest.mark.parametrize(
    "products",
    [without_region(FREE_ACTIVE), without_region(FREE_MINUTES)],
    ids=["franquia-pipelines-sem-regionCode", "franquia-minutos-sem-regionCode"],
)
def test_build_accepts_aws_variants(products: list[Product]) -> None:
    assert SERVICE.build(REGIONS[0], products) == EXPECTED


def test_unknown_region() -> None:
    message = "região sem prefixo de usagetype do CodePipeline"
    with pytest.raises(PricingError) as info:
        SERVICE.queries("eu-west-1")
    assert str(info.value) == message
    with pytest.raises(PricingError) as info:
        SERVICE.build("eu-west-1", fetched(REGIONS[0]))
    assert str(info.value) == message


US = fetched(REGIONS[0])
PAID = {
    ACTIVE_US: Dimension("pipelines", "0", None, "1"),
    MINUTES_US: Dimension("minutes", "0", None, "0.002"),
}


def regional_cases(aws_sku: str, sku: str, other_unit: str) -> dict[str, tuple[list[Product], str]]:
    paid = PAID[aws_sku]
    return {
        "duplicado": (
            [*US, replace(PRODUCTS[aws_sku], sku="OUTRO1")],
            f"mais de um produto da AWS: {sku}",
        ),
        "unidade": (
            swap(aws_sku, replace(paid, unit=other_unit)),
            f"unidade da AWS inesperada: {sku}",
        ),
        "faixa-0": (swap(aws_sku, replace(paid, usd="0")), f"primeira faixa sem preço: {sku}"),
    }


def franchise_cases(
    aws_sku: str, sku: str, unit: str, end: str, other_unit: str
) -> dict[str, tuple[list[Product], str]]:
    free, message = Dimension(unit, "0", end, "0"), f"franquia ausente ou fora do formato: {sku}"
    product = PRODUCTS[aws_sku]
    return {
        "sem-franquia": ([p for p in US if p.sku != aws_sku], message),
        "franquia-duplicada": ([*US, replace(product, sku="OUTRO2")], message),
        "franquia-2": (swap(aws_sku, free, replace(free, begin=end, end=None, usd="1")), message),
        "franquia-paga": (swap(aws_sku, replace(free, usd="0.001")), message),
        "inf": (swap(aws_sku, replace(free, end=None)), message),
        "franquia-inicio": (swap(aws_sku, replace(free, begin="1")), message),
        "franquia-unidade": (swap(aws_sku, replace(free, unit=other_unit)), message),
        "franquia-regional": (
            [
                *(p for p in US if p.sku != aws_sku),
                replace(product, attributes={**product.attributes, "regionCode": "us-east-1"}),
            ],
            message,
        ),
    }


def prefixed(
    prefix: str, cases: dict[str, tuple[list[Product], str]]
) -> dict[str, tuple[list[Product], str]]:
    return {f"{prefix}-{name}": case for name, case in cases.items()}


FREE_ACTIVE_MESSAGE = f"franquia ausente ou fora do formato: {ACTIVE}"
CASES: dict[str, tuple[list[Product], str]] = {
    **prefixed("pipelines", regional_cases(ACTIVE_US, ACTIVE, "minutes")),
    **prefixed("minutos", regional_cases(MINUTES_US, MINUTES, "pipelines")),
    # As franquias vêm antes dos produtos regionais, na ordem dos itens.
    "vazio": ([], FREE_ACTIVE_MESSAGE),
    "franquias-antes-do-regional": (
        [p for p in swap(ACTIVE_US, replace(PAID[ACTIVE_US], usd="0")) if p.sku != FREE_MINUTES],
        f"franquia ausente ou fora do formato: {MINUTES}",
    ),
    "franquia-de-outra-familia": (
        [replace(p, family="Action Execution Minutes") if p.sku == FREE_ACTIVE else p for p in US],
        FREE_ACTIVE_MESSAGE,
    ),
    **prefixed("pipelines", franchise_cases(FREE_ACTIVE, ACTIVE, "pipelines", "1", "minutes")),
    **prefixed("minutos", franchise_cases(FREE_MINUTES, MINUTES, "minutes", "100", "pipelines")),
}


@pytest.mark.parametrize(("products", "message"), CASES.values(), ids=CASES)
def test_build_rejects(products: list[Product], message: str) -> None:
    with pytest.raises(PricingError) as info:
        SERVICE.build(REGIONS[0], products)
    # Mensagem fixa e só com o SKU do catálogo: nenhum texto da AWS.
    assert str(info.value) == message


def test_generate_requires_both_items(tmp_path: Path) -> None:
    def without_regional_minutes(query: Query) -> list[Product]:
        regional = {f"{prefix}actionExecutionMinute" for prefix in PREFIX.values()}
        return [p for p in fetch(query) if p.attributes["usagetype"] not in regional]

    with pytest.raises(PricingError, match=f"SKU esperado ausente: {MINUTES}"):
        generate([SERVICE], without_regional_minutes, tmp_path, NOW)


@pytest.mark.parametrize("region", REGIONS)
def test_generate_matches_versioned_seed(region: str, tmp_path: Path) -> None:
    produced = json.loads(
        generate([SERVICE], fetch, tmp_path, NOW).files[f"{region}/codepipeline.json"]
    )
    seeded = json.loads((SEED / region / "codepipeline.json").read_bytes())
    assert validate_price_file(seeded) == []
    assert (seeded["service"], seeded["region"]) == ("codepipeline", region)
    assert SERVICE.expected_skus == {ACTIVE, MINUTES}
    assert {p["sku"] for p in seeded["prices"]} == SERVICE.expected_skus
    # Sem faixas nem `freeTier.quantity`: números da AWS que o workflow semanal (#29) atualiza.
    for price in (*produced["prices"], *seeded["prices"]):
        del price["tiers"], price["freeTier"]["quantity"]
    assert produced["prices"] == seeded["prices"]
