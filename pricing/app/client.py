"""Cliente da Price List Query API (`GetProducts`), paginado e com filtros."""

import re
from typing import Any, Protocol, cast

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

from app.model import PricingError, Product, Query
from app.products import parse_product

_ERROR_CODE = re.compile(r"[A-Za-z0-9.]{1,64}")


class PricingClient(Protocol):
    """O que o gerador usa do cliente `pricing` do boto3."""

    def get_paginator(self, operation_name: str) -> Any: ...


def make_client() -> PricingClient:
    """Cliente `pricing` na us-east-1 (endpoint da Query API), credenciais do ambiente."""
    config = Config(
        retries={"mode": "standard", "max_attempts": 5}, connect_timeout=5, read_timeout=30
    )
    return cast(PricingClient, boto3.client("pricing", region_name="us-east-1", config=config))


def fetch_products(client: PricingClient, query: Query, *, max_pages: int = 50) -> list[Product]:
    """Todos os produtos da consulta, ordenados por SKU; `PricingError` se passar de `max_pages`."""
    base = f"GetProducts falhou para {query.service_code}"
    filters = [{"Type": f.type, "Field": f.field, "Value": f.value} for f in query.filters]
    pages = client.get_paginator("get_products").paginate(
        ServiceCode=query.service_code,
        Filters=filters,
        FormatVersion="aws_v1",
        PaginationConfig={"PageSize": 100},
    )
    products: dict[str, Product] = {}
    try:
        for number, page in enumerate(pages, start=1):
            if number > max_pages:
                raise PricingError(f"{query.service_code} passou de {max_pages} páginas")
            items = page.get("PriceList", []) if isinstance(page, dict) else None
            if not isinstance(items, list):
                raise PricingError(f"PriceList inválida em {query.service_code}")
            for item in items:
                try:
                    product = parse_product(item)
                except PricingError as exc:
                    # Mensagens do parse são fixas (no máximo o SKU validado).
                    raise PricingError(f"{query.service_code}: {exc}") from None
                if product.sku in products:
                    raise PricingError(f"SKU repetido em {query.service_code}: {product.sku}")
                products[product.sku] = product
    except ClientError as err:
        code = err.response.get("Error", {}).get("Code")
        if isinstance(code, str) and _ERROR_CODE.fullmatch(code):
            raise PricingError(f"{base}: {code}") from None
        raise PricingError(base) from None
    except BotoCoreError:
        raise PricingError(base) from None
    return sorted(products.values(), key=lambda p: p.sku)
