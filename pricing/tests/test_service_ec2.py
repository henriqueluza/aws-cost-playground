"""Bloco EC2: consultas, preços a partir da Price List real (fixtures) e a semente versionada.

Fixtures: bulk offer file público do AmazonEC2 publicado em 24/11/2026 e baixado em 26/11/2026,
só com o termo OnDemand (o `GetProducts` real traz também o Reserved, que `parse_product` ignora).
"""

import json
import re
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path

import pytest

from app.catalog import PRICES_DIR
from app.generate import generate
from app.model import Dimension, Filter, Price, PricingError, Product, Query, Tier
from app.products import parse_product
from app.schema import validate_price_file
from app.services.ec2 import SERVICE

ROOT = Path(__file__).resolve().parents[2]
SEED = ROOT / PRICES_DIR
FIXTURES = Path(__file__).parent / "fixtures"
NOW = datetime(2026, 11, 26, tzinfo=UTC)
REGIONS = ("us-east-1", "sa-east-1")
US = REGIONS[0]
TYPES = (
    *("t3.micro", "t3.small", "t3.medium", "t3.large", "t4g.micro", "t4g.small", "t4g.medium"),
    *("m5.large", "m5.xlarge", "c5.large", "r5.large"),
)
# Preços das fixtures, na ordem de TYPES, e o do gp3 por último.
USD = {
    "us-east-1": (
        *("0.0104", "0.0208", "0.0416", "0.0832", "0.0084", "0.0168", "0.0336"),
        *("0.096", "0.192", "0.085", "0.126", "0.08"),
    ),
    "sa-east-1": (
        *("0.0168", "0.0336", "0.0672", "0.1344", "0.0134", "0.0268", "0.0536"),
        *("0.153", "0.306", "0.131", "0.201", "0.152"),
    ),
}
# SKUs da AWS em us-east-1: t3.medium Linux/Shared/NA/Used/OnDemand e o volume gp3.
MEDIUM, GP3 = "NN4EGUUQRWVYP98C", "JG3KUJMBRGHV3N8G"
# Iscas de us-east-1: t3.medium Windows, RHEL, Dedicated, Host, reserva não usada, reserva
# alocada e SQL Web; t3.nano (fora do conjunto); gp2; IOPS e throughput do gp3.
DECOYS = frozenset(
    {
        *("G9WBYAXUDWGW7XYV", "9ZQJCCWN4TPK2R4C", "Y7S4Y6NEXCGN6K58", "P2PQP9HJAX67JDN3"),
        *("PDB2GXXP8FHTY5J7", "2WNQZB58XQWS4QBZ", "UCK5J8S9TNVP9K9U", "K7ERD2Q28HHU97DT"),
        *("HY3BZPP2B6K8MSJF", "7Q58NR58VQEASA4W", "SQUFRQX4K92S4SBB"),
    }
)
ALL = [
    parse_product(line)
    for region in REGIONS
    for line in (FIXTURES / f"ec2-{region}.jsonl").read_text("utf-8").splitlines()
    if line
]
PRODUCTS = {p.sku: p for p in ALL}


def fetch(query: Query) -> list[Product]:
    """Emula o TERM_MATCH do `GetProducts` sobre as fixtures (só atributos: sem `productFamily`)."""
    assert query.service_code == "AmazonEC2"
    assert all(f.type == "TERM_MATCH" for f in query.filters)
    return [p for p in ALL if all(p.attributes.get(f.field) == f.value for f in query.filters)]


def fetched(region: str) -> list[Product]:
    return [p for query in SERVICE.queries(region) for p in fetch(query)]


def expected(region: str) -> tuple[Price, ...]:
    *hourly, gp3 = USD[region]
    return (
        *(
            Price(f"ec2-instance-{t}", f"Instância {t} (Linux)", "hour", (Tier(None, usd),))
            for t, usd in zip(TYPES, hourly, strict=True)
        ),
        Price("ec2-ebs-gp3", "Volume EBS gp3", "GB-month", (Tier(None, gp3),)),
    )


def swap(sku: str, *dimensions: Dimension) -> list[Product]:
    return [replace(p, dimensions=dimensions) if p.sku == sku else p for p in fetched(US)]


@pytest.mark.parametrize("region", REGIONS)
def test_queries(region: str) -> None:
    def query(*pairs: tuple[str, str]) -> Query:
        narrow = (Filter(field, value) for field, value in pairs)
        return Query("AmazonEC2", (Filter("regionCode", region), *narrow))

    linux = (("operatingSystem", "Linux"), ("tenancy", "Shared"), ("preInstalledSw", "NA"))
    on_demand = (("capacitystatus", "Used"), ("marketoption", "OnDemand"))
    assert SERVICE.queries(region) == (
        *(query(("instanceType", t), *linux, *on_demand) for t in TYPES),
        query(("volumeApiName", "gp3"), ("group", "EBS Storage")),
    )


def test_closed_set_follows_the_block_contract() -> None:
    blocks = json.loads((ROOT / "contracts" / "blocks.json").read_bytes())["blocks"]
    ec2 = next(b for b in blocks if b["type"] == "aws.ec2")
    options = next(a["options"] for a in ec2["attributes"] if a["key"] == "instanceType")
    assert SERVICE.expected_skus == {f"ec2-instance-{t}" for t in options} | {"ec2-ebs-gp3"}
    queried = [{f.field: f.value for f in q.filters} for q in SERVICE.queries(US)]
    assert [q["instanceType"] for q in queried if "instanceType" in q] == options


@pytest.mark.parametrize("region", REGIONS)
def test_build_from_price_list(region: str) -> None:
    answer = fetched(region)
    # As consultas trazem só os 12 produtos do conjunto fechado: nenhuma isca.
    assert len(answer) == 12
    assert DECOYS.isdisjoint(p.sku for p in answer)
    prices = SERVICE.build(region, answer)
    assert prices == expected(region)
    assert all(p.free_tier is None for p in prices)
    # Iscas e a outra região ficam fora mesmo se vierem na resposta.
    assert SERVICE.build(region, ALL) == expected(region)
    # Sem produto do conjunto fechado não sai preço (a falta fica para `expected_skus`).
    taken = {p.sku for p in answer}
    assert SERVICE.build(region, [p for p in ALL if p.sku not in taken]) == ()


def test_build_ignores_capacity_block() -> None:
    used = PRODUCTS[MEDIUM]
    block = {**used.attributes, "marketoption": "CapacityBlock"}
    answer = [*fetched(US), replace(used, sku="CAPACITYBLOCK1", attributes=block)]
    assert SERVICE.build(US, answer) == expected(US)


def twice(sku: str) -> list[Product]:
    """Outro SKU da AWS com os mesmos atributos somado à resposta."""
    return [*fetched(US), replace(PRODUCTS[sku], sku="OUTRO1")]


T3, EBS = "ec2-instance-t3.medium", "ec2-ebs-gp3"
HOURS, GB = Dimension("Hrs", "0", None, "0.0416"), Dimension("GB-Mo", "0", None, "0.08")
CASES: dict[str, tuple[list[Product], str]] = {
    "instancia-duplicada": (twice(MEDIUM), f"mais de um produto da AWS: {T3}"),
    "gp3-duplicado": (twice(GP3), f"mais de um produto da AWS: {EBS}"),
    "unidade-instancia": (
        swap(MEDIUM, replace(HOURS, unit="GB-Mo")),
        f"unidade da AWS inesperada: {T3}",
    ),
    "unidade-gp3": (swap(GP3, replace(GB, unit="Hrs")), f"unidade da AWS inesperada: {EBS}"),
    "faixa-0-instancia": (swap(MEDIUM, replace(HOURS, usd="0")), f"primeira faixa sem preço: {T3}"),
    "faixa-0-gp3": (swap(GP3, replace(GB, usd="0")), f"primeira faixa sem preço: {EBS}"),
}


@pytest.mark.parametrize(("products", "message"), CASES.values(), ids=CASES)
def test_build_rejects(products: list[Product], message: str) -> None:
    with pytest.raises(PricingError) as info:
        SERVICE.build(US, products)
    # Mensagem fixa e só com o SKU do catálogo: nenhum texto da AWS.
    assert str(info.value) == message


def test_generate_requires_every_instance_type(tmp_path: Path) -> None:
    def without_r5(query: Query) -> list[Product]:
        return [p for p in fetch(query) if p.attributes.get("instanceType") != "r5.large"]

    missing = re.escape("SKU esperado ausente: ec2-instance-r5.large")
    with pytest.raises(PricingError, match=missing):
        generate([SERVICE], without_r5, tmp_path, NOW)


@pytest.mark.parametrize("region", REGIONS)
def test_generate_matches_versioned_seed(region: str, tmp_path: Path) -> None:
    produced = json.loads(generate([SERVICE], fetch, tmp_path, NOW).files[f"{region}/ec2.json"])
    seeded = json.loads((SEED / region / "ec2.json").read_bytes())
    assert validate_price_file(seeded) == []
    assert (seeded["service"], seeded["region"]) == ("ec2", region)
    assert {p["sku"] for p in seeded["prices"]} == SERVICE.expected_skus
    assert not any("freeTier" in p for p in (*produced["prices"], *seeded["prices"]))
    # Sem faixas: números da AWS que o workflow semanal (#29) atualiza.
    for price in (*produced["prices"], *seeded["prices"]):
        del price["tiers"]
    assert produced["prices"] == seeded["prices"]
