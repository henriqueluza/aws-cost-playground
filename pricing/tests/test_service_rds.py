"""Bloco RDS: consultas, preços a partir da Price List real (fixtures) e a semente versionada.

Fixtures: bulk offer file público da AWS publicado em 24/11/2026 e baixado em 26/11/2026. Cada
uma tem os 38 produtos do conjunto fechado e 8 de ruído: UnusedBox:db.t3.micro de PostgreSQL e
MySQL (mesmos atributos da instância Single-AZ, outro usagetype), MariaDB db.t3.micro,
PostgreSQL db.t3.large, gp2, gp3 "Multi-AZ (readable standbys)" e backup do Aurora PostgreSQL e
do "PostgreSQL (on-premise for Outpost)".
"""

import json
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
from app.services.rds import SERVICE, USAGETYPE_PREFIX, build, queries

REGIONS = ("us-east-1", "sa-east-1")
FIXTURES = Path(__file__).parent / "fixtures"
SEED = Path(__file__).resolve().parents[2] / PRICES_DIR
NOW = datetime(2026, 11, 26, tzinfo=UTC)
PREFIX = {"us-east-1": "", "sa-east-1": "SAE1-"}
ENGINES = {"postgres": "PostgreSQL", "mysql": "MySQL"}
DEPLOYMENTS = {"single-az": "Single-AZ", "multi-az": "Multi-AZ"}
INSTANCE_USAGE = {"single-az": "InstanceUsage", "multi-az": "Multi-AZUsage"}
GP3_USAGE = {"single-az": "RDS:GP3-Storage", "multi-az": "RDS:Multi-AZ-GP3-Storage"}

# USD por hora nas fixtures: motor, classe e (Single-AZ, Multi-AZ) em us-east-1 e em sa-east-1.
_HOURLY = """
postgres db.t3.micro   0.018 0.036 0.038 0.076
postgres db.t3.small   0.036 0.072 0.076 0.151
postgres db.t3.medium  0.072 0.145 0.151 0.302
postgres db.t4g.micro  0.016 0.032 0.034 0.069
postgres db.t4g.small  0.032 0.065 0.069 0.137
postgres db.t4g.medium 0.065 0.129 0.137 0.275
postgres db.m5.large   0.178 0.356 0.233 0.466
postgres db.r5.large   0.25  0.5   0.524 1.047
mysql    db.t3.micro   0.017 0.034 0.035 0.07
mysql    db.t3.small   0.034 0.068 0.07  0.14
mysql    db.t3.medium  0.068 0.136 0.14  0.28
mysql    db.t4g.micro  0.016 0.032 0.034 0.069
mysql    db.t4g.small  0.032 0.065 0.069 0.137
mysql    db.t4g.medium 0.065 0.129 0.137 0.275
mysql    db.m5.large   0.171 0.342 0.231 0.462
mysql    db.r5.large   0.24  0.48  0.5   1
"""
_ROWS = [line.split() for line in _HOURLY.strip().splitlines()]
HOURLY = {e: {klass: usd for engine, klass, *usd in _ROWS if engine == e} for e in ENGINES}
# USD por GB-mês, iguais nos dois motores: gp3 (Single-AZ, Multi-AZ) e backup.
GP3 = {"us-east-1": ("0.115", "0.23"), "sa-east-1": ("0.219", "0.438")}
BACKUP = {"us-east-1": "0.095", "sa-east-1": "0.095"}
# SKUs da AWS em us-east-1 de uma instância, um gp3 e um backup.
AWS_SKUS = {
    "rds-postgres-db.t3.micro-single-az": "TGN7QDJF2AGFU9XA",
    "rds-mysql-gp3-multi-az": "BVC2XPZ4DHBCJX5Q",
    "rds-postgres-backup": "6W8ECRFVDATCER7J",
}
INSTANCE, GP3_SKU, BACKUP_SKU = AWS_SKUS


def _load(region: str) -> list[Product]:
    lines = (FIXTURES / f"rds-{region}.jsonl").read_text(encoding="utf-8").splitlines()
    return [parse_product(line) for line in lines if line]


# As duas fixtures juntas, com o ruído.
ALL = [p for region in REGIONS for p in _load(region)]


def fetch(query: Query) -> list[Product]:
    """Emula o TERM_MATCH do `GetProducts` sobre as fixtures."""
    assert query.service_code == "AmazonRDS"
    assert all(f.type == "TERM_MATCH" for f in query.filters)
    return [p for p in ALL if all(p.attributes.get(f.field) == f.value for f in query.filters)]


def answer(region: str) -> list[Product]:
    return [product for query in queries(region) for product in fetch(query)]


def _expected(region: str) -> tuple[Price, ...]:
    """Na ordem das consultas. Sem `freeTier` nem `minimum_quantity`: o RDS não tem franquia
    perpétua na Price List (o nível gratuito de 12 meses não vem como faixa nem como produto).
    """
    side = REGIONS.index(region) * 2  # Coluna de HOURLY onde a região começa.
    prices: list[Price] = []

    def add(sku: str, description: str, unit: str, usd: str) -> None:
        prices.append(Price(sku, description, unit, (Tier(None, usd),)))

    for engine, name in ENGINES.items():
        for klass, usd in HOURLY[engine].items():
            for i, (deployment, option) in enumerate(DEPLOYMENTS.items()):
                sku = f"rds-{engine}-{klass}-{deployment}"
                add(sku, f"Instância {klass} {name} {option}", "instance-hour", usd[side + i])
        for i, (deployment, option) in enumerate(DEPLOYMENTS.items()):
            sku = f"rds-{engine}-gp3-{deployment}"
            add(sku, f"Armazenamento gp3 {name} {option}", "GB-month", GP3[region][i])
        add(f"rds-{engine}-backup", f"Backup {name} além do incluído", "GB-month", BACKUP[region])
    return tuple(prices)


EXPECTED = {region: _expected(region) for region in REGIONS}


def test_service_spec() -> None:
    assert (SERVICE.slug, SERVICE.service_code) == ("rds", "AmazonRDS")
    assert SERVICE.expected_skus == {p.sku for p in EXPECTED["us-east-1"]}
    assert set(USAGETYPE_PREFIX) == CATALOG_REGIONS


@pytest.mark.parametrize("region", REGIONS)
def test_queries_are_narrow(region: str) -> None:
    def query(engine: str, *filters: tuple[str, str]) -> Query:
        narrow = (Filter(field, value) for field, value in filters)
        base = (Filter("regionCode", region), Filter("databaseEngine", ENGINES[engine]))
        return Query("AmazonRDS", (*base, *narrow))

    def usage(usagetype: str) -> tuple[str, str]:
        return ("usagetype", PREFIX[region] + usagetype)

    expected: list[Query] = []
    for engine in ENGINES:
        for klass in HOURLY[engine]:
            for d, option in DEPLOYMENTS.items():
                instance = usage(f"{INSTANCE_USAGE[d]}:{klass}")
                expected.append(query(engine, ("deploymentOption", option), instance))
        for d, option in DEPLOYMENTS.items():
            expected.append(query(engine, ("deploymentOption", option), usage(GP3_USAGE[d])))
        # Backup não separa por implantação: sem `deploymentOption`.
        expected.append(query(engine, usage("RDS:ChargedBackupUsage")))
    assert queries(region) == SERVICE.queries(region) == tuple(expected)


def test_closed_set_follows_the_block_contract() -> None:
    contract = SEED.parents[2] / "contracts" / "blocks.json"
    blocks = json.loads(contract.read_bytes())["blocks"]
    rds = next(b for b in blocks if b["type"] == "aws.rds")
    engines, classes, deployments = (
        next(a["options"] for a in rds["attributes"] if a["key"] == key)
        for key in ("engine", "instanceClass", "deployment")
    )
    assert SERVICE.expected_skus == {
        f"rds-{e}-{suffix}"
        for e in engines
        for suffix in ("backup", *(f"{x}-{d}" for d in deployments for x in ("gp3", *classes)))
    }


@pytest.mark.parametrize("region", REGIONS)
def test_each_query_matches_exactly_one_product(region: str) -> None:
    # Sobre as duas fixtures juntas: nem ruído nem produto da outra região passam no filtro.
    for query in queries(region):
        assert [p.attributes["regionCode"] for p in fetch(query)] == [region], query
    assert len({p.sku for p in answer(region)}) == 38


@pytest.mark.parametrize("region", REGIONS)
def test_build_takes_only_the_closed_set(region: str) -> None:
    other = next(r for r in REGIONS if r != region)
    assert build(region, answer(region)) == EXPECTED[region]
    # Ruído e produtos da outra região são ignorados mesmo se vierem na resposta.
    assert build(region, ALL) == EXPECTED[region]
    assert build(region, answer(other)) == ()
    assert build(region, []) == ()


@pytest.mark.parametrize("region", REGIONS)
def test_noise_and_unused_box_give_no_price(region: str) -> None:
    closed = {p.sku for r in REGIONS for p in answer(r)}
    noise = [p for p in ALL if p.sku not in closed]
    assert [len([p for p in noise if p.attributes["regionCode"] == r]) for r in REGIONS] == [8, 8]
    assert build(region, noise) == ()
    # O UnusedBox tem os atributos da instância Single-AZ e só o usagetype o separa.
    unused_box = [p for p in noise if "UnusedBox:" in p.attributes["usagetype"]]
    assert len(unused_box) == 4
    assert build(region, unused_box) == ()


@pytest.mark.parametrize(("sku", "aws_sku"), AWS_SKUS.items(), ids=AWS_SKUS)
def test_missing_product_drops_only_its_sku(sku: str, aws_sku: str) -> None:
    prices = build("us-east-1", [p for p in answer("us-east-1") if p.sku != aws_sku])
    assert prices == tuple(p for p in EXPECTED["us-east-1"] if p.sku != sku)


US = answer("us-east-1")
HOUR, GB = Dimension("Hrs", "0", None, "0.018"), Dimension("GB-Mo", "0", None, "0.23")


def _dims(sku: str, *dimensions: Dimension) -> list[Product]:
    return [replace(p, dimensions=dimensions) if p.sku == AWS_SKUS[sku] else p for p in US]


def _duplicate(sku: str) -> list[Product]:
    return [*US, replace(next(p for p in US if p.sku == AWS_SKUS[sku]), sku="DUPLICATE1")]


DUP, UNIT = "mais de um produto da AWS", "unidade da AWS inesperada"
ZERO = "primeira faixa sem preço"
FREE_FIRST = _dims(GP3_SKU, replace(GB, end="20", usd="0"), replace(GB, begin="20"))
CASES: dict[str, tuple[list[Product], str, str]] = {
    "duplicate-instance": (_duplicate(INSTANCE), DUP, INSTANCE),
    "duplicate-backup": (_duplicate(BACKUP_SKU), DUP, BACKUP_SKU),
    "unit-instance": (_dims(INSTANCE, replace(HOUR, unit="GB-Mo")), UNIT, INSTANCE),
    "unit-gp3": (_dims(GP3_SKU, replace(GB, unit="Hrs")), UNIT, GP3_SKU),
    "zero-instance": (_dims(INSTANCE, replace(HOUR, usd="0")), ZERO, INSTANCE),
    # 1ª faixa grátis não vira franquia no RDS: é recusada.
    "free-first-tier-gp3": (FREE_FIRST, ZERO, GP3_SKU),
}


@pytest.mark.parametrize(("products", "reason", "sku"), CASES.values(), ids=CASES)
def test_build_rejects_unexpected_shapes(products: list[Product], reason: str, sku: str) -> None:
    with pytest.raises(PricingError) as info:
        build("us-east-1", products)
    # Mensagem fixa e só com o SKU do catálogo: nenhum texto da AWS.
    assert str(info.value) == f"{reason}: {sku}"


@pytest.mark.parametrize("region", REGIONS)
def test_generated_file_matches_the_versioned_seed(region: str, tmp_path: Path) -> None:
    generated = json.loads(generate([SERVICE], fetch, tmp_path, NOW).files[f"{region}/rds.json"])
    seed = json.loads((SEED / region / "rds.json").read_bytes())
    for doc in (generated, seed):
        assert validate_price_file(doc) == []
        assert (doc["service"], doc["region"]) == ("rds", region)
        assert {p["sku"] for p in doc["prices"]} == SERVICE.expected_skus
        assert not any("freeTier" in p for p in doc["prices"])
    # Faixas conferidas contra as fixtures (pelo EXPECTED), não contra a semente.
    assert {p["sku"]: p["tiers"] for p in generated["prices"]} == {
        p.sku: [{"upTo": t.up_to, "unitPrice": t.unit_price} for t in p.tiers]
        for p in EXPECTED[region]
    }
    # Sem faixas: números da AWS que o workflow semanal (#29) atualiza.
    for price in (*generated["prices"], *seed["prices"]):
        del price["tiers"]
    assert generated["prices"] == seed["prices"]
