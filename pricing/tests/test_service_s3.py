import json
from pathlib import Path

import boto3
import pytest
from botocore.stub import Stubber

from app.catalog import PRICES_DIR
from app.checks import blocking
from app.client import fetch_products
from app.model import Filter, PricingError, Product, Query
from app.products import parse_product
from app.render import render_price_file
from app.services.s3 import SERVICE, build, queries

ROOT = Path(__file__).resolve().parents[2]
US, SA = "us-east-1", "sa-east-1"
LOCATION = {US: "US East (N. Virginia)", SA: "South America (Sao Paulo)"}
IA = "Standard - Infrequent Access"
USAGETYPES = (
    "TimedStorage-ByteHrs",
    "TimedStorage-SIA-ByteHrs",
    "Requests-Tier1",
    "Requests-Tier2",
    "Requests-SIA-Tier1",
    "Requests-SIA-Tier2",
)
SKUS = {
    "s3-storage-standard",
    "s3-storage-standard-ia",
    "s3-requests-put-standard",
    "s3-requests-get-standard",
    "s3-requests-put-standard-ia",
    "s3-requests-get-standard-ia",
}


def item(
    region: str,
    sku: str,
    usagetype: str,
    *usd: str,
    family: str = "",
    unit: str = "",
    volume: str = "",
) -> str:
    """Item do PriceList (`aws_v1`) como os reais do S3; com 3 preços, faixas de 50 e 500 TB."""
    storage = "TimedStorage" in usagetype
    bounds = (*("0", "51200", "512000")[: len(usd)], "Inf")
    term = f"{sku}.JRTCKXETXF"
    dimensions = {
        f"{term}.R{index}": {
            "rateCode": f"{term}.R{index}",
            "description": f"${price} per unit",
            "beginRange": bounds[index],
            "endRange": bounds[index + 1],
            "unit": unit or ("GB-Mo" if storage else "Requests"),
            "pricePerUnit": {"USD": price},
            "appliesTo": [],
        }
        for index, price in enumerate(usd)
    }
    attributes = {
        "servicecode": "AmazonS3",
        "location": LOCATION[region],
        "locationType": "AWS Region",
        "usagetype": usagetype,
        "operation": "",
        "regionCode": region,
        "servicename": "Amazon Simple Storage Service",
    }
    if volume:
        attributes["volumeType"] = volume
    product = {
        "sku": sku,
        "productFamily": family or ("Storage" if storage else "API Request"),
        "attributes": attributes,
    }
    on_demand = {"offerTermCode": "JRTCKXETXF", "sku": sku, "priceDimensions": dimensions}
    return json.dumps(
        {
            "product": product,
            "serviceCode": "AmazonS3",
            "terms": {"OnDemand": {term: {**on_demand, "termAttributes": {}}}},
            "version": "20261125152611",
            "publicationDate": "2026-11-25T15:26:11Z",
        }
    )


STD_US = ("0.0230000000", "0.0220000000", "0.0210000000")
STD_SA = ("0.0405000000", "0.0390000000", "0.0370000000")
RIGHT = {
    US: [
        item(US, "WP9ANXZGBYYSGJEA", "TimedStorage-ByteHrs", *STD_US, volume="Standard"),
        item(US, "379GYJUQ5WFBUYGM", "TimedStorage-SIA-ByteHrs", "0.0125000000", volume=IA),
        item(US, "E9YHNFENF4XQBZR6", "Requests-Tier1", "0.0000050000"),
        item(US, "ZWQ6Q48CRJXX4FXE", "Requests-Tier2", "0.0000004000"),
        item(US, "FNYHUPR3T466JJYM", "Requests-SIA-Tier1", "0.0000100000"),
        item(US, "GWU4HUHFNSRYMYNK", "Requests-SIA-Tier2", "0.0000010000"),
    ],
    SA: [
        item(SA, "ZNX83R5ZU4NXKACG", "SAE1-TimedStorage-ByteHrs", *STD_SA, volume="Standard"),
        item(SA, "JX8EJ6EW8U55EW87", "SAE1-TimedStorage-SIA-ByteHrs", "0.0221000000", volume=IA),
        item(SA, "EFD42GHQBGKAPBHU", "SAE1-Requests-Tier1", "0.0000070000"),
        item(SA, "BRDE588JVSNAD298", "SAE1-Requests-Tier2", "0.0000005600"),
        item(SA, "U4ZTW7WB63598VN6", "SAE1-Requests-SIA-Tier1", "0.0000100000"),
        item(SA, "PWEY58GJNM5ZVREZ", "SAE1-Requests-SIA-Tier2", "0.0000010000"),
    ],
}
# Itens reais que as consultas não pedem e sintéticos que diferem num só atributo do filtro.
NOISE = [
    item(US, "V7YYPPZU6NVVFB6Q", "Requests-Annotation-Tier1", "0.0000050000"),
    item(US, "T5CD4UDRVV44YE2T", "TimedStorage-INT-FA-ByteHrs", *STD_US),
    item(SA, "SM8MAVBCWPJRTF4Q", "SAE1-Requests-Annotation-Tier1", "0.0000070000"),
    item(SA, "FV8B7M9MW6M3S9EQ", "SAE1-TimedStorage-INT-FA-ByteHrs", *STD_SA),
    item(SA, "OTHERREGION1", "TimedStorage-ByteHrs", *STD_US, volume="Standard"),
    item(US, "WRONGFAMILY1", "Requests-Tier2", "0.0000004000", family="Fee"),
    item(US, "WRONGVOLUME1", "TimedStorage-SIA-ByteHrs", "0.0125", volume="Glacier"),
]


def parse(raws: list[str]) -> list[Product]:
    return [parse_product(raw) for raw in raws]


@pytest.mark.parametrize(("region", "prefix"), [(US, ""), (SA, "SAE1-")])
def test_queries_one_per_usagetype_with_region_prefix(region: str, prefix: str) -> None:
    assert queries(region) == tuple(
        Query("AmazonS3", (Filter("regionCode", region), Filter("usagetype", prefix + usagetype)))
        for usagetype in USAGETYPES
    )


def test_unknown_region_fails() -> None:
    with pytest.raises(PricingError, match=r"^região sem prefixo de usagetype do S3$"):
        queries("eu-west-1")
    with pytest.raises(PricingError, match=r"^região sem prefixo de usagetype do S3$"):
        build("eu-west-1", [])


def test_service_spec() -> None:
    assert (SERVICE.slug, SERVICE.service_code) == ("s3", "AmazonS3")
    assert (SERVICE.queries, SERVICE.build, SERVICE.expected_skus) == (queries, build, SKUS)


def test_build_takes_only_the_exact_product_even_if_the_response_ignores_filters() -> None:
    noise = [*NOISE, *RIGHT[SA]]
    assert build(US, parse(noise)) == ()
    assert {p.sku for p in build(US, parse([*noise, *RIGHT[US]]))} == SKUS


@pytest.mark.parametrize("region", [US, SA])
def test_build_renders_the_versioned_seed(region: str) -> None:
    products = parse([*NOISE, *RIGHT[US], *RIGHT[SA]])
    seed = (ROOT / PRICES_DIR / region / "s3.json").read_bytes()
    assert render_price_file("s3", region, build(region, products)) == seed


def test_two_products_for_one_sku_fail() -> None:
    copy = item(US, "COPYSTANDARD1", "TimedStorage-ByteHrs", "0.023", volume="Standard")
    with pytest.raises(PricingError, match=r"^mais de um produto para s3-storage-standard$"):
        build(US, parse([*RIGHT[US], copy]))


def test_unexpected_unit_fails() -> None:
    storage = item(US, "BADUNIT1", "TimedStorage-SIA-ByteHrs", "0.0125", unit="GB-Hrs", volume=IA)
    request = item(US, "BADUNIT2", "Requests-Tier1", "0.005", unit="1K Requests")
    with pytest.raises(PricingError, match=r"^unidade inesperada para s3-storage-standard-ia$"):
        build(US, parse([storage]))
    with pytest.raises(PricingError, match=r"^unidade inesperada para s3-requests-put-standard$"):
        build(US, parse([request]))


def test_missing_product_leaves_the_sku_out_and_blocks_the_file() -> None:
    prices = build(US, parse(RIGHT[US][:-1]))
    assert {p.sku for p in prices} == SKUS - {"s3-requests-get-standard-ia"}
    content = render_price_file("s3", US, prices)
    missing = ["SKU esperado ausente: s3-requests-get-standard-ia"]
    assert blocking(SERVICE, prices, content) == missing


def test_fetch_sends_the_query_filters_to_get_products() -> None:
    client = boto3.client(
        "pricing",
        region_name="us-east-1",
        aws_access_key_id="testing",
        aws_secret_access_key="testing",  # noqa: S106 - credencial falsa, sem rede
    )
    expected = {
        "ServiceCode": "AmazonS3",
        "Filters": [
            {"Type": "TERM_MATCH", "Field": "regionCode", "Value": "sa-east-1"},
            {"Type": "TERM_MATCH", "Field": "usagetype", "Value": "SAE1-TimedStorage-ByteHrs"},
        ],
        "FormatVersion": "aws_v1",
        "MaxResults": 100,
    }
    with Stubber(client) as stubber:
        stubber.add_response("get_products", {"PriceList": [RIGHT[SA][0]]}, expected)
        products = fetch_products(client, queries(SA)[0])
        stubber.assert_no_pending_responses()
    assert [p.sku for p in products] == ["ZNX83R5ZU4NXKACG"]
