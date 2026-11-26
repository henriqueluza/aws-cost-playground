"""Cognito (`aws.cognito`): usuários ativos mensais (MAU) dos tiers Lite, Essentials e Plus.

Fora: MAU federado (SAML/OIDC, Enterprise), proteção avançada (ASF), replicação multirregião
(MRR), M2M, cota de RPS e preços legados de user pool.
"""

from collections.abc import Mapping, Sequence

from app.model import (
    Filter,
    FreeTier,
    Price,
    PricingError,
    Product,
    Query,
    ServiceSpec,
    region_filter,
)
from app.products import tiers

_CODE = "AmazonCognito"
_UNITS = frozenset({"CognitoUserPoolsMAU"})
# Produto global da franquia (sem `operation`) e o pool que Lite e Essentials dividem.
_FREE_USAGETYPE, _POOL = "Global-CognitoFreeTierMAU", "cognito-mau"
# Conjunto fechado: SKU do catálogo -> (operation da AWS, descrição, tem franquia).
_SKUS: Mapping[str, tuple[str, str, bool]] = {
    "cognito-mau-lite": ("CognitoLiteOperation", "Usuários ativos mensais (Lite)", True),
    "cognito-mau-essentials": (
        "CognitoEssentialsOperation",
        "Usuários ativos mensais (Essentials)",
        True,
    ),
    "cognito-mau-plus": ("CognitoPlusOperation", "Usuários ativos mensais (Plus)", False),
}


def queries(region: str) -> tuple[Query, ...]:
    """Uma consulta por tier na região e uma para a franquia, que é global."""
    regional = tuple(
        Query(_CODE, (region_filter(region), Filter("operation", op)))
        for op, _, _ in _SKUS.values()
    )
    free = Query(_CODE, (Filter("usagetype", _FREE_USAGETYPE),))
    return (*regional, free)


def _select(products: Sequence[Product], region: str, **attributes: str) -> list[Product]:
    """Da região e com os atributos; `region` vazio é o global (`regionCode` vazio ou ausente)."""
    return [
        p
        for p in products
        if p.attributes.get("regionCode", "") == region
        and all(p.attributes.get(k) == v for k, v in attributes.items())
    ]


def _free_tier(products: Sequence[Product]) -> FreeTier:
    """Franquia do único produto global: uma faixa grátis a partir de zero com fim finito."""
    message = f"franquia ausente ou fora do formato: {_POOL}"
    found = _select(products, "", usagetype=_FREE_USAGETYPE)
    if len(found) != 1 or len(found[0].dimensions) != 1:
        raise PricingError(message)
    (dimension,) = found[0].dimensions
    if dimension.unit not in _UNITS or dimension.end is None:
        raise PricingError(message)
    # `decimal_text` já normalizou zero para "0".
    if (dimension.begin, dimension.usd) != ("0", "0"):
        raise PricingError(message)
    return FreeTier(quantity=dimension.end, pool=_POOL)


def _price(products: Sequence[Product], region: str, sku: str, free: FreeTier) -> Price | None:
    operation, description, has_free = _SKUS[sku]
    found = _select(products, region, operation=operation)
    if len(found) > 1:
        raise PricingError(f"mais de um produto da AWS: {sku}")
    if not found:
        return None
    if any(d.unit not in _UNITS for d in found[0].dimensions):
        raise PricingError(f"unidade da AWS inesperada: {sku}")
    # A AWS já desloca as faixas pela franquia; elas entram como vêm.
    price_tiers = tiers(found[0].dimensions)
    # Zero sai sempre "0" (`decimal_text`); 1ª faixa grátis contaria a franquia duas vezes.
    if price_tiers[0].unit_price == "0":
        raise PricingError(f"primeira faixa sem preço: {sku}")
    return Price(sku, description, "MAU", price_tiers, free if has_free else None)


def build(region: str, products: Sequence[Product]) -> tuple[Price, ...]:
    """Franquia uma vez, mesmo só com Plus na região; SKU sem produto não sai."""
    free = _free_tier(products)
    prices = (_price(products, region, sku, free) for sku in _SKUS)
    return tuple(price for price in prices if price is not None)


SERVICE = ServiceSpec(
    slug="cognito", service_code=_CODE, queries=queries, build=build, expected_skus=frozenset(_SKUS)
)
