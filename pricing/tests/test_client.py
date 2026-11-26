import json
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

import boto3
import pytest
from botocore.exceptions import EndpointConnectionError
from botocore.stub import Stubber

from app.client import fetch_products, make_client
from app.model import Filter, PricingError, Query


def item(sku: str, usd: str = "0.0000002000") -> str:
    return json.dumps(
        {
            "product": {
                "sku": sku,
                "productFamily": "Serverless",
                "attributes": {"regionCode": "us-east-1"},
            },
            "serviceCode": "AWSLambda",
            "terms": {
                "OnDemand": {
                    f"{sku}.JRTCKXETXF": {
                        "priceDimensions": {
                            f"{sku}.JRTCKXETXF.6YS6EN2CT7": {
                                "unit": "Requests",
                                "beginRange": "0",
                                "endRange": "Inf",
                                "pricePerUnit": {"USD": usd},
                                "description": "x",
                            }
                        }
                    }
                }
            },
        }
    )


def params(query: Query, token: str | None = None) -> dict[str, Any]:
    expected: dict[str, Any] = {
        "ServiceCode": query.service_code,
        "Filters": [{"Type": f.type, "Field": f.field, "Value": f.value} for f in query.filters],
        "FormatVersion": "aws_v1",
        "MaxResults": 100,
    }
    if token is not None:
        expected["NextToken"] = token
    return expected


@contextmanager
def stubbed() -> Iterator[tuple[Any, Stubber]]:
    client = boto3.client(
        "pricing",
        region_name="us-east-1",
        aws_access_key_id="testing",
        aws_secret_access_key="testing",  # noqa: S106 - credencial falsa, sem rede
    )
    with Stubber(client) as stubber:
        yield client, stubber
        stubber.assert_no_pending_responses()


QUERY = Query(
    "AmazonEC2", (Filter("regionCode", "us-east-1"), Filter("tenancy", "Shared", "EQUALS"))
)


def test_joins_pages_sorted_by_sku_and_sends_params() -> None:
    with stubbed() as (client, stubber):
        stubber.add_response(
            "get_products",
            {"PriceList": [item("ZZZ"), item("MMM")], "NextToken": "tok1"},
            params(QUERY),
        )
        stubber.add_response("get_products", {"PriceList": [item("AAA")]}, params(QUERY, "tok1"))
        products = fetch_products(client, QUERY)
    assert [p.sku for p in products] == ["AAA", "MMM", "ZZZ"]
    assert products[0].dimensions[0].usd == "0.0000002"


def test_empty_filters_are_sent_as_empty_list() -> None:
    query = Query("AWSLambda", ())
    with stubbed() as (client, stubber):
        stubber.add_response("get_products", {"PriceList": [item("A1")]}, params(query))
        products = fetch_products(client, query)
    assert [p.sku for p in products] == ["A1"]


def test_missing_price_list_is_empty() -> None:
    with stubbed() as (client, stubber):
        stubber.add_response("get_products", {"NextToken": "t"}, params(QUERY))
        stubber.add_response("get_products", {"PriceList": [item("B1")]}, params(QUERY, "t"))
        products = fetch_products(client, QUERY)
    assert [p.sku for p in products] == ["B1"]


def test_more_pages_than_max_pages_fails() -> None:
    with stubbed() as (client, stubber):
        stubber.add_response("get_products", {"PriceList": [item("A")], "NextToken": "t"})
        stubber.add_response("get_products", {"PriceList": [item("B")]})
        with pytest.raises(PricingError):
            fetch_products(client, QUERY, max_pages=1)


def test_duplicate_sku_fails() -> None:
    with stubbed() as (client, stubber):
        stubber.add_response("get_products", {"PriceList": [item("A"), item("A")]})
        with pytest.raises(PricingError):
            fetch_products(client, QUERY)


def test_malformed_item_names_the_service_without_aws_text() -> None:
    with stubbed() as (client, stubber):
        stubber.add_response("get_products", {"PriceList": ["VAZOU não é JSON"]})
        with pytest.raises(PricingError) as err:
            fetch_products(client, QUERY)
    assert "AmazonEC2" in str(err.value)
    assert "VAZOU" not in str(err.value)


def test_duplicate_sku_across_pages_fails() -> None:
    with stubbed() as (client, stubber):
        stubber.add_response("get_products", {"PriceList": [item("A")], "NextToken": "t"})
        stubber.add_response("get_products", {"PriceList": [item("A")]})
        with pytest.raises(PricingError):
            fetch_products(client, QUERY)


def test_client_error_message_has_service_and_code_but_no_aws_text() -> None:
    with stubbed() as (client, stubber):
        stubber.add_client_error(
            "get_products",
            service_error_code="AccessDeniedException",
            service_message="VAZOU-segredo",
        )
        with pytest.raises(PricingError) as info:
            fetch_products(client, QUERY)
    message = str(info.value)
    assert "AmazonEC2" in message
    assert "AccessDeniedException" in message
    assert "VAZOU" not in message


def test_client_error_with_invalid_code_is_not_echoed() -> None:
    with stubbed() as (client, stubber):
        stubber.add_client_error(
            "get_products", service_error_code="bad code!", service_message="VAZOU-segredo"
        )
        with pytest.raises(PricingError) as info:
            fetch_products(client, QUERY)
    message = str(info.value)
    assert "bad code!" not in message
    assert "VAZOU" not in message


def test_make_client_region_and_service(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "testing")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "testing")
    client: Any = make_client()
    assert client.meta.region_name == "us-east-1"
    assert client.meta.service_model.service_name == "pricing"


class FakeClient:
    """Paginador falso para respostas que o Stubber recusaria (fora do modelo do botocore)."""

    def __init__(self, pages: Iterator[dict[str, Any]]) -> None:
        self.pages = pages

    def get_paginator(self, operation_name: str) -> FakeClient:
        return self

    def paginate(self, **kwargs: Any) -> Iterator[dict[str, Any]]:
        return self.pages


def test_price_list_not_a_list_fails() -> None:
    with pytest.raises(PricingError):
        fetch_products(FakeClient(iter([{"PriceList": "VAZOU"}])), QUERY)


def test_botocore_error_has_no_aws_text() -> None:
    def pages() -> Iterator[dict[str, Any]]:
        raise EndpointConnectionError(endpoint_url="https://VAZOU.example")
        yield {}

    with pytest.raises(PricingError) as err:
        fetch_products(FakeClient(pages()), QUERY)
    assert "AmazonEC2" in str(err.value)
    assert "VAZOU" not in str(err.value)
