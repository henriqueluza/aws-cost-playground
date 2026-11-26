"""Bloco ElastiCache: consultas, preços da Price List real (fixtures) e a semente versionada.

Fixtures: bulk offer file público da AWS publicado em 25/11/2026 e baixado em 26/11/2026.
"""

import json
from collections.abc import Callable
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path

import pytest

from app.catalog import PRICES_DIR
from app.catalog import REGIONS as CATALOG_REGIONS
from app.generate import generate
from app.model import Dimension, Filter, Price, PricingError, Product, Query, Tier
from app.products import parse_product
from app.schema import validate_price_file
from app.services.elasticache import SERVICE, build, queries

REGIONS = ("us-east-1", "sa-east-1")
ROOT = Path(__file__).resolve().parents[2]
FIXTURES = Path(__file__).parent / "fixtures"
SEED = ROOT / PRICES_DIR
PREFIX = {"us-east-1": "", "sa-east-1": "SAE1-"}
# Motor do catálogo -> (operation da AWS, nome na descrição).
ENGINES = {
    "redis": ("CreateCacheCluster:0002", "Redis OSS"),
    "memcached": ("CreateCacheCluster:0001", "Memcached"),
}
NODES = (
    "cache.t3.micro",
    "cache.t3.small",
    "cache.t3.medium",
    "cache.t4g.micro",
    "cache.t4g.small",
    "cache.t4g.medium",
    "cache.m5.large",
    "cache.r5.large",
)
# SKU do catálogo -> (motor, tipo de nó), na ordem do contrato: redis e depois memcached.
SKUS = {f"elasticache-{e}-{n}": (e, n) for e in ENGINES for n in NODES}
# USD por nó-hora, na ordem de NODES; Redis = Memcached. `decimal_text` tira zeros à direita.
USD = {
    "us-east-1": ("0.017", "0.034", "0.068", "0.016", "0.032", "0.065", "0.156", "0.216"),
    "sa-east-1": ("0.032", "0.064", "0.128", "0.03", "0.061", "0.122", "0.223", "0.432"),
}
EXPECTED = {
    region: tuple(
        Price(f"elasticache-{e}-{n}", f"Nó {n} ({label})", "node-hour", (Tier(None, usd),))
        for e, (_, label) in ENGINES.items()
        for n, usd in zip(NODES, prices, strict=True)
    )
    for region, prices in USD.items()
}
REDIS, MEMCACHED = "elasticache-redis-cache.t3.micro", "elasticache-memcached-cache.r5.large"


def _load(region: str) -> list[Product]:
    lines = (FIXTURES / f"elasticache-{region}.jsonl").read_text(encoding="utf-8").splitlines()
    return [parse_product(line) for line in lines if line]


# As duas fixtures juntas, com o ruído (Valkey, Extended Support, Outposts, m6g, Serverless...).
ALL = [p for region in REGIONS for p in _load(region)]


def fetch(query: Query) -> list[Product]:
    """Emula o TERM_MATCH do `GetProducts` sobre as fixtures."""
    assert query.service_code == "AmazonElastiCache"
    assert all(f.type == "TERM_MATCH" for f in query.filters)
    return [p for p in ALL if all(p.attributes.get(f.field) == f.value for f in query.filters)]


def answer(region: str) -> list[Product]:
    return [product for query in queries(region) for product in fetch(query)]


def filters(region: str, sku: str) -> tuple[Filter, ...]:
    """Filtros do contrato: região, tipo de nó pelo `usagetype` e motor pela `operation`."""
    engine, node = SKUS[sku]
    return (
        Filter("regionCode", region),
        Filter("usagetype", f"{PREFIX[region]}NodeUsage:{node}"),
        Filter("operation", ENGINES[engine][0]),
    )


def aws_sku(region: str, sku: str) -> str:
    """SKU da AWS do produto que vira `sku`, achado pelos atributos e não fixado no teste."""
    (found,) = fetch(Query("AmazonElastiCache", filters(region, sku)))
    return found.sku


def test_closed_set_matches_the_block_contract() -> None:
    blocks = json.loads((ROOT / "contracts" / "blocks.json").read_text("utf-8"))["blocks"]
    block = next(b for b in blocks if b["type"] == "aws.elasticache")
    options = {a["key"]: tuple(a["options"]) for a in block["attributes"]}
    assert (options["engine"], options["nodeType"]) == (tuple(ENGINES), NODES)
    assert len(SKUS) == 16
    assert SERVICE.expected_skus == frozenset(SKUS)
    assert set(PREFIX) == CATALOG_REGIONS


@pytest.mark.parametrize("region", REGIONS)
def test_queries_are_narrow(region: str) -> None:
    assert queries(region) == tuple(Query("AmazonElastiCache", filters(region, s)) for s in SKUS)


@pytest.mark.parametrize("region", REGIONS)
def test_build_takes_only_the_closed_set(region: str) -> None:
    assert build(region, answer(region)) == EXPECTED[region]
    # Ruído e produtos da outra região são ignorados.
    assert build(region, ALL) == EXPECTED[region]
    assert build(region, []) == ()
    other = next(r for r in REGIONS if r != region)
    assert build(region, answer(other)) == ()


@pytest.mark.parametrize("region", REGIONS)
def test_noise_gives_no_price(region: str) -> None:
    # Valkey, Extended Support, Outposts e m6g cobram nó-hora como os do contrato.
    noise = [p for p in _load(region) if p not in answer(region)]
    assert len(noise) == 6
    assert build(region, noise) == ()


@pytest.mark.parametrize("region", REGIONS)
def test_every_price_is_one_open_tier_without_free_tier(region: str) -> None:
    # O ElastiCache não tem franquia permanente (só a de 12 meses, fora do projeto) nem faixas.
    prices = build(region, answer(region))
    assert len(prices) == len(SKUS)
    for price in prices:
        assert len(price.tiers) == 1
        assert price.tiers[0].up_to is None
        assert price.free_tier is None
        assert price.minimum_quantity is None


# Redis e Memcached têm o mesmo preço: só o sumiço do SKU certo prova que o motor não se trocou.
@pytest.mark.parametrize("sku", SKUS)
@pytest.mark.parametrize("region", REGIONS)
def test_missing_product_is_left_to_expected_skus(region: str, sku: str) -> None:
    gone = aws_sku(region, sku)
    prices = build(region, [p for p in answer(region) if p.sku != gone])
    assert prices == tuple(p for p in EXPECTED[region] if p.sku != sku)


@pytest.mark.parametrize("region", ["eu-west-1", "", "US-EAST-1"])
def test_unknown_region_is_refused(region: str) -> None:
    calls: tuple[Callable[[], object], ...] = (
        lambda: queries(region),
        lambda: build(region, ALL),
        lambda: build(region, []),
    )
    for call in calls:
        with pytest.raises(PricingError) as info:
            call()
        assert str(info.value) == "região sem prefixo de usagetype"


Change = Callable[[list[Product]], list[Product]]
HRS = Dimension("Hrs", "0", None, "0.017")


def _dims(sku: str, *dimensions: Dimension) -> Change:
    aws = aws_sku("us-east-1", sku)
    return lambda ps: [replace(p, dimensions=dimensions) if p.sku == aws else p for p in ps]


def _duplicate(sku: str) -> Change:
    aws = aws_sku("us-east-1", sku)
    return lambda ps: [*ps, replace(next(p for p in ps if p.sku == aws), sku="DUPLICATE1")]


CASES: dict[str, tuple[Change, str]] = {
    "duplicate": (_duplicate(REDIS), f"mais de um produto da AWS: {REDIS}"),
    "duplicate-memcached": (_duplicate(MEMCACHED), f"mais de um produto da AWS: {MEMCACHED}"),
    "unit": (_dims(REDIS, replace(HRS, unit="Hours")), f"unidade da AWS inesperada: {REDIS}"),
    # Unidade é checada antes do preço.
    "unit-before-price": (
        _dims(REDIS, replace(HRS, unit="Hours", usd="0")),
        f"unidade da AWS inesperada: {REDIS}",
    ),
    "zero-price": (_dims(REDIS, replace(HRS, usd="0")), f"primeira faixa sem preço: {REDIS}"),
    # A franquia de 12 meses (750 h) não é modelada: faixa grátis é recusada.
    "free-first-tier": (
        _dims(MEMCACHED, replace(HRS, end="750", usd="0"), replace(HRS, begin="750")),
        f"primeira faixa sem preço: {MEMCACHED}",
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
    now = datetime(2026, 11, 26, tzinfo=UTC)
    result = generate([SERVICE], fetch, tmp_path, now)
    generated = json.loads(result.files[f"{region}/elasticache.json"])
    seed = json.loads((SEED / region / "elasticache.json").read_bytes())
    assert validate_price_file(seed) == []
    # O render ordena os preços por SKU; a ordem do contrato vale para `queries` e `build`.
    assert [p["sku"] for p in seed["prices"]] == sorted(SKUS)
    # Sem as faixas: números da AWS que o workflow semanal (#29) atualiza. Sku, descrição,
    # unidade e a ausência de `freeTier` seguem comparados.
    for price in (*generated["prices"], *seed["prices"]):
        del price["tiers"]
    assert generated["prices"] == seed["prices"]
