"""Bloco CloudWatch: consultas, preços da Price List real (fixtures) e a semente versionada.

Fixtures: bulk offer file público da AWS publicado em 25/11/2026 e baixado em 26/11/2026.
"""

import json
from collections.abc import Callable
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path

import pytest

from app.catalog import PRICES_DIR
from app.generate import generate
from app.model import Dimension, Filter, FreeTier, Price, PricingError, Product, Query, Tier
from app.products import parse_product
from app.schema import validate_price_file
from app.services.cloudwatch import SERVICE, build, queries

REGIONS = ("us-east-1", "sa-east-1")
FIXTURES = Path(__file__).parent / "fixtures"
SEED = Path(__file__).resolve().parents[2] / PRICES_DIR
NOW = datetime(2026, 11, 26, tzinfo=UTC)
SKUS = (
    "cloudwatch-logs-ingestion",
    "cloudwatch-logs-storage",
    "cloudwatch-custom-metrics",
    "cloudwatch-alarms",
)
INDEXED = tuple(enumerate(SKUS))
# SKUs da AWS, na ordem de SKUS: produto regional de cada região e produto global da franquia.
REGIONAL = {
    "us-east-1": ("S8QGXX5R2BKKMDSJ", "6K9ADYQAHV5KX9KZ", "KG586CTNGQ4VRZKZ", "EVETVUGEN3MUTMXM"),
    "sa-east-1": ("AW4EB5RGNN8S75Q8", "A2U5G2V8PAN8BBGE", "69U4T5WYC2VZMA9G", "H7K9WCM7G7GJWU8G"),
}
GLOBAL = ("SSNSJENVU973ECHE", "6XTVPDAM3VF25UTA", "3ZJZSGX8K87XPW4R", "FCH8WPMWVXA4B6VM")
# Ruído das fixtures: ingestão Legacy e vended logs, armazenamento legacy, alarmes de alta
# resolução e compostos e a franquia do Logs Insights (DataScanned, global).
NOISE = {
    "us-east-1": {
        "96K55R2PV3ZZZ3AM",
        "GHRXAWYBWDN7X39F",
        "JRHJQ2UMPUB5K73A",
        "7BK9TRWG8E43D4AJ",
        "FXNEUU7HXFXDQXC8",
        "W5GFVRZDCZQHBBU2",
    },
    "sa-east-1": {"467VTCQDZUVP3S5E", "VEVKGJRK85UX92QM", "BU3QGF8QVZUCUMMN", "W5GFVRZDCZQHBBU2"},
}


def _load(region: str) -> list[Product]:
    lines = (FIXTURES / f"cloudwatch-{region}.jsonl").read_text(encoding="utf-8").splitlines()
    return [parse_product(line) for line in lines if line]


# As duas fixtures juntas; os produtos globais aparecem nas duas e na Price List são um só.
ALL = list({p.sku: p for region in REGIONS for p in _load(region)}.values())


def fetch(query: Query) -> list[Product]:
    """Emula o TERM_MATCH do `GetProducts` sobre as fixtures."""
    assert query.service_code == "AmazonCloudWatch"
    assert all(f.type == "TERM_MATCH" for f in query.filters)
    return [p for p in ALL if all(p.attributes.get(f.field) == f.value for f in query.filters)]


def answer(region: str) -> list[Product]:
    return [product for query in queries(region) for product in fetch(query)]


ROWS = (
    ("cloudwatch-logs-ingestion", "Ingestão de logs (Standard)", "GB", "5"),
    ("cloudwatch-logs-storage", "Armazenamento de logs", "GB-month", "5"),
    ("cloudwatch-custom-metrics", "Métricas customizadas", "metric-month", "10"),
    ("cloudwatch-alarms", "Alarmes (resolução padrão)", "alarm-month", "10"),
)
METRICS = (Tier("10000", "0.3"), Tier("250000", "0.1"), Tier("1000000", "0.05"), Tier(None, "0.02"))
TIERS = {
    "us-east-1": ((Tier(None, "0.5"),), (Tier(None, "0.03"),), METRICS, (Tier(None, "0.1"),)),
    "sa-east-1": ((Tier(None, "0.9"),), (Tier(None, "0.0408"),), METRICS, (Tier(None, "0.135"),)),
}
# Franquia sem pool: cada SKU tem a sua.
EXPECTED = {
    region: tuple(
        Price(sku, description, unit, price_tiers, FreeTier(free))
        for (sku, description, unit, free), price_tiers in zip(ROWS, by_sku, strict=True)
    )
    for region, by_sku in TIERS.items()
}


def test_service_declares_the_closed_set() -> None:
    assert (SERVICE.slug, SERVICE.service_code) == ("cloudwatch", "AmazonCloudWatch")
    assert frozenset(SKUS) == SERVICE.expected_skus


@pytest.mark.parametrize("region", REGIONS)
def test_queries_are_narrow(region: str) -> None:
    def query(*filters: tuple[str, str]) -> Query:
        return Query("AmazonCloudWatch", tuple(Filter(field, value) for field, value in filters))

    here = ("regionCode", region)
    logs = ("groupDescription", "Existing system, application, and custom log files")
    storage = ("group", "Amazon CloudWatch Standard Storage pricing current")
    metric = ("groupDescription", "CloudWatch Custom Metrics")
    assert queries(region) == (
        query(here, ("group", "Ingested Logs"), logs, ("version", "Current")),
        query(here, storage),
        query(here, ("group", "Metric"), metric),
        query(here, ("group", "Alarm"), ("alarmType", "Standard")),
        query(
            ("usagetype", "Global-DataProcessing-Bytes"), ("group", "CW-MonthlyFree-DataProcessing")
        ),
        query(("usagetype", "Global-TimedStorage-ByteHrs"), ("group", "CW-MonthlyFree-Archival")),
        query(("usagetype", "Global-CW:MetricMonitorUsage"), ("group", "CW-MonthlyFree-Metric")),
        query(("usagetype", "Global-CW:AlarmMonitorUsage"), ("group", "CW-MonthlyFree-Alarm")),
    )


@pytest.mark.parametrize("region", REGIONS)
def test_each_query_matches_only_its_product(region: str) -> None:
    # A fixture traz o ruído que o filtro precisa tirar.
    assert {p.sku for p in _load(region)} == {*REGIONAL[region], *GLOBAL, *NOISE[region]}
    selected = [[p.sku for p in fetch(query)] for query in queries(region)]
    assert selected == [[sku] for sku in (*REGIONAL[region], *GLOBAL)]


@pytest.mark.parametrize("region", REGIONS)
def test_build_takes_only_the_closed_set(region: str) -> None:
    assert build(region, answer(region)) == EXPECTED[region]
    # Sem filtro: Legacy (mesmo group e groupDescription), vended, alta resolução, compostos,
    # DataScanned e a outra região ficam fora, e o Legacy não conta como duplicado.
    assert build(region, ALL) == EXPECTED[region]
    # Sem produto regional não sai preço, mas as franquias seguem exigidas.
    assert build(region, [p for p in ALL if p.sku in GLOBAL]) == ()


def test_free_tier_product_may_omit_region_code() -> None:
    def strip(p: Product) -> Product:
        attributes = {k: v for k, v in p.attributes.items() if k != "regionCode"}
        return replace(p, attributes=attributes) if p.sku in GLOBAL else p

    assert build("us-east-1", [strip(p) for p in answer("us-east-1")]) == EXPECTED["us-east-1"]


Change = Callable[[list[Product]], list[Product]]


def _dims(aws_sku: str, *dimensions: Dimension) -> Change:
    return lambda ps: [replace(p, dimensions=dimensions) if p.sku == aws_sku else p for p in ps]


def _attrs(aws_sku: str, **attributes: str) -> Change:
    def change(ps: list[Product]) -> list[Product]:
        return [
            replace(p, attributes={**p.attributes, **attributes}) if p.sku == aws_sku else p
            for p in ps
        ]

    return change


def _without(aws_sku: str) -> Change:
    return lambda ps: [p for p in ps if p.sku != aws_sku]


def _copy(aws_sku: str) -> Change:
    return lambda ps: [*ps, replace(next(p for p in ps if p.sku == aws_sku), sku="COPY1")]


def _then(*changes: Change) -> Change:
    def change(ps: list[Product]) -> list[Product]:
        for step in changes:
            ps = step(ps)
        return ps

    return change


@pytest.mark.parametrize(("index", "sku"), INDEXED, ids=SKUS)
def test_free_tier_comes_from_its_own_global_product(index: int, sku: str) -> None:
    product = next(p for p in ALL if p.sku == GLOBAL[index])
    change = _dims(GLOBAL[index], replace(product.dimensions[0], end="123"))
    prices = build("us-east-1", change(answer("us-east-1")))
    assert prices == tuple(
        replace(p, free_tier=FreeTier("123")) if p.sku == sku else p for p in EXPECTED["us-east-1"]
    )


@pytest.mark.parametrize(("index", "sku"), INDEXED, ids=SKUS)
def test_each_sku_requires_its_free_tier(index: int, sku: str) -> None:
    message = f"franquia ausente ou fora do formato: {sku}"
    with pytest.raises(PricingError) as info:
        build("us-east-1", _without(GLOBAL[index])(answer("us-east-1")))
    assert str(info.value) == message
    # A franquia é exigida mesmo sem nenhum produto regional.
    with pytest.raises(PricingError) as info:
        build("us-east-1", [p for p in ALL if p.sku in GLOBAL and p.sku != GLOBAL[index]])
    assert str(info.value) == message


@pytest.mark.parametrize(("index", "sku"), INDEXED, ids=SKUS)
def test_missing_regional_product_fails_generate(index: int, sku: str, tmp_path: Path) -> None:
    gone = {REGIONAL[region][index] for region in REGIONS}
    prices = build("us-east-1", [p for p in answer("us-east-1") if p.sku not in gone])
    assert {p.sku for p in prices} == SERVICE.expected_skus - {sku}

    def without(query: Query) -> list[Product]:
        return [p for p in fetch(query) if p.sku not in gone]

    with pytest.raises(PricingError) as info:
        generate([SERVICE], without, tmp_path, NOW)
    assert str(info.value).splitlines() == [
        f"{region}/cloudwatch.json: SKU esperado ausente: {sku}" for region in sorted(REGIONS)
    ]


INGEST, _, METRIC, ALARM = REGIONAL["us-east-1"]
FREE_INGEST, FREE_ALARM = GLOBAL[0], GLOBAL[3]
FREE_DIM = Dimension("GB", "0", "5", "0")
LOGS, METRICS_SKU = "cloudwatch-logs-ingestion", "cloudwatch-custom-metrics"
FREE = f"franquia ausente ou fora do formato: {LOGS}"


def _metrics(*changes: dict[str, str | None]) -> Change:
    bounds = (("0", "10000", "0.3"), ("10000", "250000", "0.1"), ("250000", None, "0.05"))
    dims = [Dimension("Metrics", begin, end, usd) for begin, end, usd in bounds]
    return _dims(METRIC, *(replace(d, **c) for d, c in zip(dims, changes, strict=True)))


CASES: dict[str, tuple[Change, str]] = {
    "empty": (lambda ps: [], FREE),
    "regional-only": (lambda ps: [p for p in ps if p.sku not in GLOBAL], FREE),
    # Todas as franquias são lidas antes de qualquer produto regional.
    "free-first": (
        _then(_copy(INGEST), _without(FREE_ALARM)),
        "franquia ausente ou fora do formato: cloudwatch-alarms",
    ),
    "free-duplicate": (_copy(FREE_INGEST), FREE),
    "free-regional": (_attrs(FREE_INGEST, regionCode="us-east-1"), FREE),
    "free-0-dims": (_dims(FREE_INGEST), FREE),
    "free-2-dims": (_dims(FREE_INGEST, FREE_DIM, Dimension("GB", "5", None, "0.5")), FREE),
    "free-unit": (_dims(FREE_INGEST, replace(FREE_DIM, unit="GB-Mo")), FREE),
    "free-begin": (_dims(FREE_INGEST, replace(FREE_DIM, begin="1")), FREE),
    "free-paid": (_dims(FREE_INGEST, replace(FREE_DIM, usd="0.5")), FREE),
    "free-inf": (_dims(FREE_INGEST, replace(FREE_DIM, end=None)), FREE),
    "duplicate": (_copy(INGEST), f"mais de um produto da AWS: {LOGS}"),
    "legacy-as-current": (
        _then(
            lambda ps: [*ps, *(p for p in ALL if p.sku == "96K55R2PV3ZZZ3AM")],
            _attrs("96K55R2PV3ZZZ3AM", version="Current"),
        ),
        f"mais de um produto da AWS: {LOGS}",
    ),
    "unit": (
        _dims(INGEST, Dimension("GB-Mo", "0", None, "0.5")),
        f"unidade da AWS inesperada: {LOGS}",
    ),
    "unit-one-tier": (
        _metrics({}, {}, {"unit": "Alarms"}),
        f"unidade da AWS inesperada: {METRICS_SKU}",
    ),
    "zero-price": (
        _dims(ALARM, Dimension("Alarms", "0", None, "0")),
        "primeira faixa sem preço: cloudwatch-alarms",
    ),
    "metrics-free-first": (
        _metrics({"usd": "0"}, {}, {}),
        f"primeira faixa sem preço: {METRICS_SKU}",
    ),
    "metrics-gap": (
        _metrics({}, {"begin": "20000"}, {}),
        "faixas sem continuidade a partir de zero",
    ),
}


@pytest.mark.parametrize(("change", "message"), CASES.values(), ids=CASES)
def test_build_rejects_unexpected_shapes(change: Change, message: str) -> None:
    with pytest.raises(PricingError) as info:
        build("us-east-1", change(answer("us-east-1")))
    # Mensagem fixa e só com o SKU do catálogo: nenhum texto da AWS.
    assert str(info.value) == message


@pytest.mark.parametrize("region", REGIONS)
def test_generated_file_matches_the_versioned_seed(region: str, tmp_path: Path) -> None:
    result = generate([SERVICE], fetch, tmp_path, NOW)
    generated = json.loads(result.files[f"{region}/cloudwatch.json"])
    seed = json.loads((SEED / region / "cloudwatch.json").read_bytes())
    assert validate_price_file(seed) == []
    assert (seed["service"], seed["region"]) == ("cloudwatch", region)
    assert {p["sku"] for p in seed["prices"]} == SERVICE.expected_skus
    # Sem faixas nem `freeTier.quantity`: números da AWS que o workflow semanal (#29) atualiza.
    # A presença de `freeTier` (e a ausência de `pool`) segue comparada.
    for price in (*generated["prices"], *seed["prices"]):
        del price["tiers"], price["freeTier"]["quantity"]
    assert generated["prices"] == seed["prices"]
