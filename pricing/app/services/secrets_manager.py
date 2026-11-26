"""Secrets Manager (`aws.secrets-manager`): segredos armazenados por mês e chamadas de API.

Fora: o trial de 30 dias, o rateio do segredo por hora e a rotação (que cobra a Lambda dela).
"""

from collections.abc import Mapping, Sequence

from app.model import Filter, Price, PricingError, Product, Query, ServiceSpec, region_filter
from app.products import tiers

_CODE = "AWSSecretsManager"
# Conjunto fechado: SKU do catálogo -> (group da AWS, unidade da AWS, unidade do catálogo,
# descrição).
_SKUS: Mapping[str, tuple[str, str, str, str]] = {
    "secrets-manager-secrets": (
        "AWSSecretsManager-Secret",
        "Secrets",
        "secret-month",
        "Segredos armazenados",
    ),
    "secrets-manager-api-requests": (
        "AWSSecretsManager-APIRequest",
        "API Requests",
        "request",
        "Chamadas de API",
    ),
}


def queries(region: str) -> tuple[Query, ...]:
    """Uma consulta por SKU na região, pelo `group` do produto da AWS."""
    return tuple(
        Query(_CODE, (region_filter(region), Filter("group", group)))
        for group, _, _, _ in _SKUS.values()
    )


def _select(products: Sequence[Product], region: str, group: str) -> list[Product]:
    """Da região e do `group` pedidos."""
    return [
        p
        for p in products
        if p.attributes.get("regionCode", "") == region and p.attributes.get("group") == group
    ]


def _price(products: Sequence[Product], region: str, sku: str) -> Price | None:
    group, aws_unit, unit, description = _SKUS[sku]
    found = _select(products, region, group)
    if len(found) > 1:
        raise PricingError(f"mais de um produto da AWS: {sku}")
    if not found:
        return None
    if any(d.unit != aws_unit for d in found[0].dimensions):
        raise PricingError(f"unidade da AWS inesperada: {sku}")
    price_tiers = tiers(found[0].dimensions)
    # Zero sai sempre "0" (`decimal_text`); faixa grátis aqui seria franquia não declarada.
    if price_tiers[0].unit_price == "0":
        raise PricingError(f"primeira faixa sem preço: {sku}")
    return Price(sku, description, unit, price_tiers, free_tier=None)


def build(region: str, products: Sequence[Product]) -> tuple[Price, ...]:
    """Um preço por SKU com produto na região; SKU sem produto não sai."""
    prices = (_price(products, region, sku) for sku in _SKUS)
    return tuple(price for price in prices if price is not None)


SERVICE = ServiceSpec(
    slug="secrets-manager",
    service_code=_CODE,
    queries=queries,
    build=build,
    expected_skus=frozenset(_SKUS),
)
