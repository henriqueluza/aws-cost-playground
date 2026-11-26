"""Bloco CloudFront sobre o bulk offer file global da AWS (19/10/2026, baixado em 26/11/2026)."""

import json
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path

import pytest

from app.catalog import PRICES_DIR
from app.generate import generate
from app.model import Filter, FreeTier, Price, PricingError, Product, Query, Tier
from app.products import parse_product
from app.schema import validate_price_file
from app.services.cloudfront import SERVICE, build, queries

REGIONS = ("us-east-1", "sa-east-1")
SEED = Path(__file__).resolve().parents[2] / PRICES_DIR
_LINES = (Path(__file__).parent / "fixtures" / "cloudfront.jsonl").read_text(encoding="utf-8")
# Price List global: as duas bordas e o ruído (proxy, HTTP e Europa) num arquivo só.
ALL = [parse_product(line) for line in _LINES.splitlines() if line]
HTTPS, OUT = "cloudfront-https-requests", "cloudfront-data-transfer-out"
# SKUs da AWS nas bordas dos Estados Unidos: requisições HTTPS e saída para a internet.
US_HTTPS, US_OUT = "NPFD6SEH9MXS8M4J", "GV2WFGX37Q9PDSHF"


def fetch(query: Query) -> list[Product]:
    """Emula o TERM_MATCH do `GetProducts` sobre a fixture (as consultas só usam atributos)."""
    return [p for p in ALL if all(p.attributes.get(f.field) == f.value for f in query.filters)]


def answer(region: str) -> list[Product]:
    return [product for query in queries(region) for product in fetch(query)]


US = answer("us-east-1")  # Requisições HTTPS e saída, nessa ordem.
LIMITS = ("10240", "51200", "153600", "512000", "1048576", "5242880", None)
US_GB = ("0.085", "0.08", "0.06", "0.04", "0.03", "0.025", "0.02")
SA_GB = ("0.11", "0.105", "0.09", "0.08", "0.06", "0.05", "0.04")


def _expected(edge: str, https: str, gb: tuple[str, ...]) -> tuple[Price, ...]:
    requests = (Tier(None, https),)
    out = tuple(Tier(up_to, usd) for up_to, usd in zip(LIMITS, gb, strict=True))
    return (
        Price(HTTPS, f"Requisições HTTPS {edge}", "request", requests, FreeTier("10000000")),
        Price(OUT, f"Saída para a internet {edge}", "GB", out, FreeTier("1024")),
    )


EXPECTED = {
    "us-east-1": _expected("(bordas dos Estados Unidos)", "0.000001", US_GB),
    "sa-east-1": _expected("(bordas da América do Sul)", "0.0000022", SA_GB),
}


@pytest.mark.parametrize(("region", "edge"), [("us-east-1", "US"), ("sa-east-1", "SA")])
def test_queries_filter_the_region_edge(region: str, edge: str) -> None:
    assert queries(region) == (
        Query("AmazonCloudFront", (Filter("usagetype", f"{edge}-Requests-Tier2-HTTPS"),)),
        Query("AmazonCloudFront", (Filter("usagetype", f"{edge}-DataTransfer-Out-Bytes"),)),
    )


def test_region_without_edge_is_refused() -> None:
    for call in (queries, lambda region: build(region, ALL)):
        with pytest.raises(PricingError, match=r"^região sem local de borda do CloudFront$"):
            call("eu-west-1")


@pytest.mark.parametrize("region", REGIONS)
def test_build_takes_only_the_closed_set(region: str) -> None:
    assert build(region, answer(region)) == EXPECTED[region]
    # Pior caso, resposta sem filtro: o ruído e a outra borda são ignorados.
    assert build(region, ALL) == EXPECTED[region]
    # Gêmeos: mesmo `usagetype`, mas com a família ou um atributo do conjunto fechado trocado.
    https, out = answer(region)
    keys = ((https, "requestType"), (out, "transferType"), (out, "toLocation"))
    other = [replace(p, attributes={**p.attributes, k: "x"}) for p, k in keys]
    assert build(region, [*ALL, replace(https, family="Fee"), *other]) == EXPECTED[region]


def test_missing_product_is_left_to_expected_skus() -> None:
    prices = build("us-east-1", [p for p in US if p.sku != US_OUT])
    assert {p.sku for p in prices} == SERVICE.expected_skus - {OUT}


def _last_tier(sku: str, **changes: str) -> list[Product]:
    """Resposta de us-east-1 com a última faixa (a aberta) do produto `sku` da AWS alterada."""
    p = next(p for p in US if p.sku == sku)
    edited = replace(p, dimensions=(*p.dimensions[:-1], replace(p.dimensions[-1], **changes)))
    return [edited if q.sku == sku else q for q in US]


# Unidade e preço zero valem para toda faixa, não só a primeira: a saída tem sete.
CASES: dict[str, tuple[list[Product], str]] = {
    "duplicate": ([*US, replace(US[0], sku="DUPLICATE1")], f"mais de um produto da AWS: {HTTPS}"),
    "unit": (_last_tier(US_HTTPS, unit="GB"), f"unidade da AWS inesperada: {HTTPS}"),
    "unit-last-tier": (_last_tier(US_OUT, unit="TB"), f"unidade da AWS inesperada: {OUT}"),
    "zero-price": (_last_tier(US_HTTPS, usd="0"), f"faixa sem preço: {HTTPS}"),
    "zero-price-last-tier": (_last_tier(US_OUT, usd="0"), f"faixa sem preço: {OUT}"),
}


@pytest.mark.parametrize(("products", "message"), CASES.values(), ids=CASES)
def test_build_rejects_unexpected_shapes(products: list[Product], message: str) -> None:
    with pytest.raises(PricingError) as info:
        build("us-east-1", products)
    # Mensagem fixa e só com o SKU do catálogo: nenhum texto da AWS.
    assert str(info.value) == message


@pytest.mark.parametrize("region", REGIONS)
def test_generated_file_matches_the_versioned_seed(region: str, tmp_path: Path) -> None:
    now = datetime(2026, 11, 26, tzinfo=UTC)
    raw = generate([SERVICE], fetch, tmp_path, now).files[f"{region}/cloudfront.json"]
    generated, seed = json.loads(raw), json.loads((SEED / region / "cloudfront.json").read_bytes())
    for content in (generated, seed):
        assert validate_price_file(content) == []
        assert {p["sku"] for p in content["prices"]} == SERVICE.expected_skus
    # Sem faixas, números da AWS que o workflow semanal (#29) atualiza; a franquia é constante.
    for price in (*generated["prices"], *seed["prices"]):
        del price["tiers"]
    assert generated["prices"] == seed["prices"]
