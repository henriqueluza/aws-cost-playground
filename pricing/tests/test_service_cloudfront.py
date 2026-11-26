import json
from collections.abc import Mapping, Sequence
from decimal import Decimal
from pathlib import Path

import pytest

from app.checks import blocking
from app.model import Filter, FreeTier, PricingError, Product, Query
from app.products import parse_product
from app.render import render_price_file
from app.services.cloudfront import SERVICE, build, queries

ROOT = Path(__file__).resolve().parents[2]
REQUESTS, TRANSFER = "cloudfront-https-requests", "cloudfront-data-transfer-out"
PLACE = {"US": "United States", "SA": "South America", "EU": "Europe"}
ENDS = ("10240", "51200", "153600", "512000", "1048576", "5242880", "Inf")
US_GB = ("0.085", "0.08", "0.06", "0.04", "0.03", "0.025", "0.02")
SA_GB = ("0.11", "0.105", "0.09", "0.08", "0.06", "0.05", "0.04")
REGION_ERROR = r"^região sem local de borda do CloudFront$"
ZERO_ERROR = r"^faixa de preço zero no CloudFront"
UNIT_ERROR = r"^unidade inesperada no CloudFront$"


def item(
    sku: str, family: str, attributes: Mapping[str, str], ranges: Sequence[tuple[str, ...]]
) -> Product:
    """Item `aws_v1` como os da Price List (preço com 10 casas), lido pelo `parse_product`."""
    term = f"{sku}.JRTCKXETXF"
    dimensions = {
        f"{term}.R{i}": {
            "rateCode": f"{term}.R{i}",
            "description": "texto da AWS",
            "beginRange": begin,
            "endRange": end,
            "unit": unit,
            "pricePerUnit": {"USD": f"{Decimal(usd):.10f}"},
            "appliesTo": [],
        }
        for i, (unit, begin, end, usd) in enumerate(ranges)
    }
    term_doc = {"offerTermCode": "JRTCKXETXF", "sku": sku, "priceDimensions": dimensions}
    raw = {
        "product": {
            "sku": sku,
            "productFamily": family,
            "attributes": {"servicecode": "AmazonCloudFront", "operation": "", **attributes},
        },
        "serviceCode": "AmazonCloudFront",
        "terms": {"OnDemand": {term: {**term_doc, "termAttributes": {}}}},
        "version": "20261019150500",
    }
    return parse_product(json.dumps(raw))


def requests(
    sku: str,
    usd: str,
    usage: str = "US-Requests-Tier2-HTTPS",
    kind: str = "CloudFront-Request-Tier2",
    unit: str = "Requests",
) -> Product:
    attributes = {"location": PLACE[usage[:2]], "usagetype": usage, "requestType": kind}
    return item(sku, "Request", attributes, [(unit, "0", "Inf", usd)])


def transfer(
    sku: str,
    prices: Sequence[str] = US_GB,
    usage: str = "US-DataTransfer-Out-Bytes",
    family: str = "Data Transfer",
    unit: str = "GB",
) -> Product:
    attributes = {
        "transferType": "CloudFront Outbound",
        "fromLocation": PLACE[usage[:2]],
        "toLocation": "External",
        "usagetype": usage,
    }
    ranges = zip(("0", *ENDS[:-1]), ENDS, prices, strict=True)
    return item(sku, family, attributes, [(unit, begin, end, usd) for begin, end, usd in ranges])


US_REQUESTS = requests("NPFD6SEH9MXS8M4J", "0.000001")
US_TRANSFER = transfer("GV2WFGX37Q9PDSHF")
DISTRACTORS = (
    requests(
        "DCX5PSWXNPZDK63Q", "0.000001", "US-Requests-HTTPS-Proxy", "CloudFront-Request-HTTPS-Proxy"
    ),
    transfer("VU3485RNDU6HBQF6", US_GB, "EU-DataTransfer-Out-Bytes"),
    transfer("FAMILIAERRADA001", family="Fee"),
)
# Resposta que ignora os filtros (pior caso): as duas bordas e os distratores juntos.
ALL = (
    US_REQUESTS,
    US_TRANSFER,
    requests("FUWQBJC8EW2AP9J4", "0.0000022", "SA-Requests-Tier2-HTTPS"),
    transfer("ZT3N6V49SHDM9P3G", SA_GB, "SA-DataTransfer-Out-Bytes"),
    *DISTRACTORS,
)


@pytest.mark.parametrize(
    ("region", "https", "out"),
    [
        ("us-east-1", "US-Requests-Tier2-HTTPS", "US-DataTransfer-Out-Bytes"),
        ("sa-east-1", "SA-Requests-Tier2-HTTPS", "SA-DataTransfer-Out-Bytes"),
    ],
)
def test_queries_filter_the_region_edge(region: str, https: str, out: str) -> None:
    assert queries(region) == (
        Query("AmazonCloudFront", (Filter("usagetype", https),)),
        Query("AmazonCloudFront", (Filter("usagetype", out),)),
    )
    assert (SERVICE.queries, SERVICE.build) == (queries, build)
    assert frozenset({REQUESTS, TRANSFER}) == SERVICE.expected_skus


def test_unknown_region_is_refused() -> None:
    with pytest.raises(PricingError, match=REGION_ERROR):
        queries("eu-west-1")
    with pytest.raises(PricingError, match=REGION_ERROR):
        build("eu-west-1", ALL)


@pytest.mark.parametrize(
    ("region", "https", "out"),
    [("us-east-1", "0.000001", "0.085"), ("sa-east-1", "0.0000022", "0.11")],
)
def test_build_takes_the_region_edge_and_adds_free_tier(region: str, https: str, out: str) -> None:
    prices = build(region, ALL)
    assert isinstance(prices, tuple)
    assert len(prices) == 2
    assert {p.sku: p.tiers[0].unit_price for p in prices} == {REQUESTS: https, TRANSFER: out}
    assert {p.sku: p.free_tier for p in prices} == {
        REQUESTS: FreeTier("10000000"),
        TRANSFER: FreeTier("1024"),
    }


@pytest.mark.parametrize("region", ["us-east-1", "sa-east-1"])
def test_build_renders_the_seed_byte_for_byte(region: str) -> None:
    seed = (ROOT / f"web/public/prices/{region}/cloudfront.json").read_bytes()
    assert render_price_file(SERVICE.slug, region, build(region, ALL)) == seed


@pytest.mark.parametrize(
    ("product", "error"),
    [
        (requests("NPFD6SEH9MXS8M4J", "0"), ZERO_ERROR),
        (transfer("GV2WFGX37Q9PDSHF", ("0", *US_GB[1:])), ZERO_ERROR),
        (requests("NPFD6SEH9MXS8M4J", "0.000001", unit="GB"), UNIT_ERROR),
        (transfer("GV2WFGX37Q9PDSHF", unit="TB"), UNIT_ERROR),
    ],
    ids=["requests-zero", "transfer-zero", "requests-unit", "transfer-unit"],
)
def test_zero_tier_and_unexpected_unit_are_refused(product: Product, error: str) -> None:
    with pytest.raises(PricingError, match=error):
        build("us-east-1", (product,))


def test_two_products_for_one_sku_are_refused() -> None:
    twin = requests("TWIN000000000001", "0.000001")
    with pytest.raises(PricingError, match=rf"^mais de um produto para {REQUESTS}$"):
        build("us-east-1", (US_REQUESTS, twin, US_TRANSFER))


def test_missing_product_is_left_out_and_blocked() -> None:
    prices = build("us-east-1", (US_REQUESTS, *DISTRACTORS))
    assert [p.sku for p in prices] == [REQUESTS]
    content = render_price_file(SERVICE.slug, "us-east-1", prices)
    assert blocking(SERVICE, prices, content) == [f"SKU esperado ausente: {TRANSFER}"]
    assert blocking(SERVICE, build("sa-east-1", ()), b"{}") == [
        "nenhum preço gerado",
        f"SKU esperado ausente: {TRANSFER}, {REQUESTS}",
    ]
