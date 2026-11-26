"""Bloco CloudTrail: consultas, preços da Price List real (fixtures) e a semente versionada.

Fixtures: bulk offer file público da AWS publicado em 25/11/2026 e baixado em 26/11/2026. Cada
região tem 5 produtos: eventos pagos (cópias de gerenciamento), de dados, grátis (preço 0), de rede
e Insights; só os dois primeiros entram no catálogo.
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
from app.services.cloudtrail import SERVICE

REGIONS = ("us-east-1", "sa-east-1")
PREFIX = {"us-east-1": "USE1-", "sa-east-1": "SAE1-"}
FIXTURES = Path(__file__).parent / "fixtures"
SEED = Path(__file__).resolve().parents[2] / PRICES_DIR
NOW = datetime(2026, 11, 26, tzinfo=UTC)
PAID_US, DATA_US = "HSTGM6MX75VC7UUF", "8QF7CPEM9ENRC6EA"  # SKUs da AWS em us-east-1
MANAGEMENT, DATA = "cloudtrail-management-events", "cloudtrail-data-events"
DATA_FAMILY = "Management Tools - AWS CloudTrail Data Events Recorded"
UNKNOWN = r"^região sem prefixo de usagetype do CloudTrail$"
# Preço por evento (gerenciamento, dados) nas fixtures.
USD = {"us-east-1": ("0.00002", "0.000001"), "sa-east-1": ("0.00002", "0.000001")}


def _load(region: str) -> list[Product]:
    lines = (FIXTURES / f"cloudtrail-{region}.jsonl").read_text(encoding="utf-8").splitlines()
    return [parse_product(line) for line in lines if line]


# As duas fixtures juntas, com o ruído real: eventos grátis, de rede e Insights.
ALL = [p for region in REGIONS for p in _load(region)]


def fetch(query: Query) -> list[Product]:
    """Emula o TERM_MATCH do `GetProducts` sobre as fixtures."""
    assert query.service_code == "AWSCloudTrail"

    def matches(product: Product, f: Filter) -> bool:
        assert f.type == "TERM_MATCH"
        value = product.family if f.field == "productFamily" else product.attributes.get(f.field)
        return value == f.value

    return [p for p in ALL if all(matches(p, f) for f in query.filters)]


def answer(region: str) -> list[Product]:
    return [product for query in SERVICE.queries(region) for product in fetch(query)]


def expected(region: str) -> tuple[Price, ...]:
    # Sem franquia nem troca de faixa: o grátis do CloudTrail é a 1ª trilha, descontada no `web/`.
    management, data = USD[region]
    return (
        Price(
            MANAGEMENT,
            "Eventos de gerenciamento (cópias adicionais)",
            "event",
            (Tier(None, management),),
        ),
        Price(DATA, "Eventos de dados", "event", (Tier(None, data),)),
    )


@pytest.mark.parametrize("region", REGIONS)
def test_queries(region: str) -> None:
    assert SERVICE.queries(region) == tuple(
        Query(
            "AWSCloudTrail",
            (Filter("regionCode", region), Filter("usagetype", PREFIX[region] + usagetype)),
        )
        for usagetype in ("PaidEventsRecorded", "DataEventsRecorded")
    )


def test_service_spec() -> None:
    assert (SERVICE.slug, SERVICE.service_code) == ("cloudtrail", "AWSCloudTrail")
    assert SERVICE.expected_skus == {MANAGEMENT, DATA}


def test_unknown_region_fails() -> None:
    with pytest.raises(PricingError, match=UNKNOWN):
        SERVICE.queries("eu-west-1")
    for products in (ALL, []):
        with pytest.raises(PricingError, match=UNKNOWN):
            SERVICE.build("eu-west-1", products)


@pytest.mark.parametrize("region", REGIONS)
def test_build_from_price_list(region: str) -> None:
    # Consulta estreita: dos 5 produtos da região, só os eventos pagos e os de dados.
    assert {p.attributes["usagetype"] for p in answer(region)} == {
        PREFIX[region] + "PaidEventsRecorded",
        PREFIX[region] + "DataEventsRecorded",
    }
    assert SERVICE.build(region, answer(region)) == expected(region)
    # Grátis, rede, Insights e a outra região ficam fora mesmo se vierem na resposta.
    assert SERVICE.build(region, ALL) == expected(region)
    # Sem produto não sai preço; `expected_skus` cobra a falta no `generate`.
    assert SERVICE.build(region, []) == ()


@pytest.mark.parametrize("region", REGIONS)
def test_build_ignores_twins_outside_the_closed_set(region: str) -> None:
    # Mesmo usagetype com outra família, outra região ou usagetype sem o prefixo da região: se
    # entrassem, dariam "mais de um produto da AWS".
    twins = [
        twin
        for p in answer(region)
        for twin in (
            replace(p, sku="TWINFAMILY1", family="Management Tools - AWS CloudTrail"),
            replace(p, sku="TWINREGION1", attributes={**p.attributes, "regionCode": "x"}),
            replace(
                p,
                sku="TWINPREFIX1",
                attributes={
                    **p.attributes,
                    "usagetype": p.attributes["usagetype"].removeprefix(PREFIX[region]),
                },
            ),
        )
    ]
    assert SERVICE.build(region, [*ALL, *twins]) == expected(region)


def test_missing_product_is_left_to_expected_skus() -> None:
    prices = SERVICE.build("us-east-1", [p for p in answer("us-east-1") if p.sku != PAID_US])
    assert prices == expected("us-east-1")[1:]


Change = Callable[[list[Product]], list[Product]]


def _duplicate(ps: list[Product]) -> list[Product]:
    return [*ps, replace(next(p for p in ps if p.sku == PAID_US), sku="DUPLICATE1")]


def _single(aws_sku: str, unit: str, usd: str) -> Change:
    """Produto `aws_sku` de us-east-1 com uma faixa só, da unidade e preço dados."""
    dimensions = (Dimension(unit, "0", None, usd),)
    return lambda ps: [replace(p, dimensions=dimensions) if p.sku == aws_sku else p for p in ps]


CASES: dict[str, tuple[Change, str]] = {
    "duplicado": (_duplicate, f"mais de um produto da AWS: {MANAGEMENT}"),
    "unidade-GB": (_single(DATA_US, "GB", "0.000001"), f"unidade da AWS inesperada: {DATA}"),
    # A unidade é exatamente "Events"; o singular também é recusado.
    "unidade-singular": (
        _single(PAID_US, "Event", "0.00002"),
        f"unidade da AWS inesperada: {MANAGEMENT}",
    ),
    "faixa-0-dados": (_single(DATA_US, "Events", "0"), f"primeira faixa sem preço: {DATA}"),
    "faixa-0-gerenciamento": (
        _single(PAID_US, "Events", "0"),
        f"primeira faixa sem preço: {MANAGEMENT}",
    ),
}


@pytest.mark.parametrize(("change", "message"), CASES.values(), ids=CASES)
def test_build_rejects_unexpected_shapes(change: Change, message: str) -> None:
    with pytest.raises(PricingError) as info:
        SERVICE.build("us-east-1", change(answer("us-east-1")))
    # Mensagem fixa e só com o SKU do catálogo: nenhum texto da AWS.
    assert str(info.value) == message


@pytest.mark.parametrize(("sku", "is_data"), [(DATA, True), (MANAGEMENT, False)])
def test_generate_requires_both_skus(sku: str, is_data: bool, tmp_path: Path) -> None:
    def without(query: Query) -> list[Product]:
        return [p for p in fetch(query) if (p.family == DATA_FAMILY) != is_data]

    with pytest.raises(PricingError, match=f"SKU esperado ausente: {sku}"):
        generate([SERVICE], without, tmp_path, NOW)


@pytest.mark.parametrize("region", REGIONS)
def test_generate_matches_versioned_seed(region: str, tmp_path: Path) -> None:
    result = generate([SERVICE], fetch, tmp_path, NOW)
    produced = json.loads(result.files[f"{region}/cloudtrail.json"])
    seeded = json.loads((SEED / region / "cloudtrail.json").read_bytes())
    assert validate_price_file(produced) == validate_price_file(seeded) == []
    assert (seeded["service"], seeded["region"]) == ("cloudtrail", region)
    assert {p["sku"] for p in seeded["prices"]} == SERVICE.expected_skus
    # Sem faixas: números da AWS que o workflow semanal (#29) atualiza. Sem franquia no CloudTrail.
    for price in (*produced["prices"], *seeded["prices"]):
        assert "freeTier" not in price
        del price["tiers"]
    assert produced == seeded
