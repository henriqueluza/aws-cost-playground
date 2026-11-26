"""Bloco NAT Gateway: consultas, preços da Price List real (fixtures) e a semente versionada.

Fixtures: bulk offer file público da AWS (AmazonEC2) publicado em 24/11/2026 e baixado em
26/11/2026.
"""

import json
from collections.abc import Callable
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path

import pytest

from app.catalog import PRICES_DIR
from app.generate import generate
from app.model import Dimension, Filter, Price, PricingError, Product, Query, Tier
from app.products import parse_product
from app.schema import validate_price_file
from app.services.nat_gateway import SERVICE, build, queries

US, SA = REGIONS = ("us-east-1", "sa-east-1")
FIXTURES = Path(__file__).parent / "fixtures"
SEED = Path(__file__).resolve().parents[2] / PRICES_DIR
NOW = datetime(2026, 11, 26, tzinfo=UTC)
SKUS = HOURS_SKU, DATA_SKU = ("nat-gateway-hours", "nat-gateway-data-processed")
# SKUs da AWS do conjunto fechado, na ordem de `SKUS`.
AWS = {US: ("M2YSHUBETB3JX4M4", "59S5R83GFPUAGVR5"), SA: ("N3JNXFX89DVACZ9Q", "SCEJ72FQAGUB53MY")}
HOURS, DATA = AWS[US]
# As duas fixtures juntas, com o ruído: NAT regional (`RegionalNatGateway`, `TransitGatewayVPC`) e,
# em us-east-1, banda provisionada (`NatGateway-Prvd-Gbps`) e `NatGateway-Prvd-Bytes` a preço zero.
ALL = [
    parse_product(line)
    for region in REGIONS
    for line in (FIXTURES / f"nat-gateway-{region}.jsonl").read_text(encoding="utf-8").splitlines()
]


def fetch(query: Query) -> list[Product]:
    """Emula o TERM_MATCH do `GetProducts` sobre as fixtures: é a resposta simulada da AWS."""
    assert query.service_code == "AmazonEC2"
    assert all(f.type == "TERM_MATCH" for f in query.filters)
    return [p for p in ALL if all(p.attributes.get(f.field) == f.value for f in query.filters)]


def answer(region: str) -> list[Product]:
    return [product for query in queries(region) for product in fetch(query)]


def built(region: str, products: list[Product]) -> list[Price]:
    """Em ordem de SKU, como no arquivo: a ordem de saída do `build` não é contrato."""
    return sorted(build(region, products), key=lambda p: p.sku)


USD = {US: "0.045", SA: "0.093"}  # A hora e o GB têm o mesmo preço em cada região.
EXPECTED = {
    region: [
        Price(DATA_SKU, "Dados processados", "GB", (Tier(None, usd),)),
        Price(HOURS_SKU, "Horas do gateway", "hour", (Tier(None, usd),)),
    ]
    for region, usd in USD.items()
}


@pytest.mark.parametrize(("region", "prefix"), [(US, ""), (SA, "SAE1-")])
def test_queries_select_only_the_closed_set(region: str, prefix: str) -> None:
    def query(usagetype: str) -> Query:
        nat, usage = Filter("operation", "NatGateway"), Filter("usagetype", prefix + usagetype)
        return Query("AmazonEC2", (Filter("regionCode", region), nat, usage))

    assert queries(region) == (query("NatGateway-Hours"), query("NatGateway-Bytes"))
    # Na resposta simulada, do ruído das fixtures só sobra o conjunto fechado.
    assert [p.sku for p in answer(region)] == list(AWS[region])


@pytest.mark.parametrize("region", REGIONS)
def test_build_takes_only_the_closed_set(region: str) -> None:
    assert built(region, answer(region)) == EXPECTED[region]
    # O ruído e a outra região não entram nem se vierem na resposta; sozinhos, não dão preço.
    assert built(region, ALL) == EXPECTED[region]
    assert build(region, [p for p in ALL if p.sku not in AWS[region]]) == ()
    assert build(region, []) == ()


@pytest.mark.parametrize(("sku", "aws_sku"), list(zip(SKUS, AWS[SA], strict=True)), ids=SKUS)
def test_sku_without_product_does_not_come_out(sku: str, aws_sku: str) -> None:
    rest = [p for p in answer(SA) if p.sku != aws_sku]
    (found,) = (p for p in answer(SA) if p.sku == aws_sku)
    # Também fora do conjunto fechado: sem o prefixo da região, de outra região ou outra operation.
    unprefixed = {"usagetype": found.attributes["usagetype"].removeprefix("SAE1-")}
    for change in (None, unprefixed, {"regionCode": US}, {"operation": "RegionalNatGateway"}):
        off = [] if change is None else [replace(found, attributes={**found.attributes, **change})]
        assert {p.sku for p in build(SA, [*rest, *off])} == SERVICE.expected_skus - {sku}


Change = Callable[[list[Product]], list[Product]]


def _dims(aws_sku: str, *dimensions: Dimension) -> Change:
    return lambda ps: [replace(p, dimensions=dimensions) if p.sku == aws_sku else p for p in ps]


HRS, GB = Dimension("Hrs", "0", None, "0.045"), Dimension("GB", "0", None, "0.045")


def test_tiers_come_from_the_price_list() -> None:
    first, rest = replace(GB, end="10240"), replace(GB, begin="10240", usd="0.04")
    data = replace(EXPECTED[US][0], tiers=(Tier("10240", "0.045"), Tier(None, "0.04")))
    assert built(US, _dims(DATA, first, rest)(answer(US))) == [data, EXPECTED[US][1]]


def _duplicate(ps: list[Product]) -> list[Product]:
    return [*ps, replace(next(p for p in ps if p.sku == HOURS), sku="DUPLICATE1")]


UNIT, ZERO = "unidade da AWS inesperada: ", "primeira faixa sem preço: "
CASES: dict[str, tuple[Change, str]] = {
    "duplicado": (_duplicate, f"mais de um produto da AWS: {HOURS_SKU}"),
    "unidade-banda": (_dims(HOURS, replace(HRS, unit="Gbps-hrs")), UNIT + HOURS_SKU),
    "unidade-hora-no-gb": (_dims(DATA, replace(GB, unit="Hrs")), UNIT + DATA_SKU),
    # Como o `NatGateway-Prvd-Bytes` da fixture: GB a preço zero não vira preço.
    "preco-zero": (_dims(DATA, replace(GB, usd="0")), ZERO + DATA_SKU),
    "faixa-gratis": (
        _dims(HOURS, replace(HRS, end="750", usd="0"), replace(HRS, begin="750")),
        ZERO + HOURS_SKU,
    ),
}


@pytest.mark.parametrize(("change", "message"), CASES.values(), ids=CASES)
def test_build_rejects_unexpected_shapes(change: Change, message: str) -> None:
    with pytest.raises(PricingError) as info:
        build(US, change(answer(US)))
    # Mensagem fixa e só com o SKU do catálogo: nenhum texto da AWS.
    assert str(info.value) == message


def test_region_outside_the_map_is_rejected() -> None:
    with pytest.raises(PricingError):
        queries("eu-west-1")
    with pytest.raises(PricingError):
        build("eu-west-1", ALL)


@pytest.mark.parametrize("region", REGIONS)
def test_generated_file_matches_the_versioned_seed(region: str, tmp_path: Path) -> None:
    files = generate([SERVICE], fetch, tmp_path, NOW).files
    generated = json.loads(files[f"{region}/nat-gateway.json"])
    seed = json.loads((SEED / region / "nat-gateway.json").read_bytes())
    assert validate_price_file(seed) == []
    assert (seed["service"], seed["region"]) == ("nat-gateway", region)
    # Sem as faixas, números da AWS que o workflow semanal (#29) atualiza; sem `freeTier`.
    rows = [{"sku": p.sku, "description": p.description, "unit": p.unit} for p in EXPECTED[region]]
    for doc in (generated, seed):
        assert [{k: v for k, v in p.items() if k != "tiers"} for p in doc["prices"]] == rows
