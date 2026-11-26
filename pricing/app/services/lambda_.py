"""Lambda (`aws.lambda`): requisições e GB-segundo por arquitetura, com a franquia mensal.

Fora: concorrência provisionada, Lambda@Edge, armazenamento efêmero, SnapStart e managed instances.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass

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

_CODE = "AWSLambda"


@dataclass(frozen=True, slots=True)
class _Kind:
    """O que x86 e arm64 dividem: unidades, o produto global da franquia e o pool."""

    unit: str
    aws_units: frozenset[str]
    free_usagetype: str
    free_group: str
    pool: str


_REQUESTS = _Kind(
    "request",
    frozenset({"Requests", "Request"}),
    "Global-Request",
    "AWS-Lambda-Requests",
    "lambda-requests",
)
_DURATION = _Kind(
    "GB-second",
    frozenset({"Lambda-GB-Second"}),
    "Global-Lambda-GB-Second",
    "AWS-Lambda-Duration",
    "lambda-duration",
)
# Conjunto fechado: SKU do catálogo -> (group do produto regional da AWS, descrição, tipo).
_SKUS: Mapping[str, tuple[str, str, _Kind]] = {
    "lambda-requests-x86": ("AWS-Lambda-Requests", "Requisições (x86)", _REQUESTS),
    "lambda-requests-arm64": ("AWS-Lambda-Requests-ARM", "Requisições (arm64)", _REQUESTS),
    "lambda-duration-x86": ("AWS-Lambda-Duration", "Duração (x86)", _DURATION),
    "lambda-duration-arm64": ("AWS-Lambda-Duration-ARM", "Duração (arm64)", _DURATION),
}


def queries(region: str) -> tuple[Query, ...]:
    """Consultas estreitas (uma por group): um item fora do formato na família não derruba."""
    regional = [
        Query(_CODE, (region_filter(region), Filter("group", g))) for g, _, _ in _SKUS.values()
    ]
    free = [
        Query(_CODE, (Filter("usagetype", k.free_usagetype), Filter("group", k.free_group)))
        for k in (_REQUESTS, _DURATION)
    ]
    return (*regional, *free)


def _select(
    products: Sequence[Product], region: str, group: str, usagetype: str | None = None
) -> list[Product]:
    """Produtos do group na região; `region` vazio é o global (`regionCode` vazio ou ausente)."""
    return [
        p
        for p in products
        if (p.attributes.get("regionCode", ""), p.attributes.get("group")) == (region, group)
        and (usagetype is None or p.attributes.get("usagetype") == usagetype)
    ]


def _free_tier(products: Sequence[Product], sku: str, kind: _Kind) -> FreeTier:
    """Um produto global com uma faixa só, de 0 até um fim finito, a preço 0."""
    found = _select(products, "", kind.free_group, kind.free_usagetype)
    first = found[0].dimensions[0] if len(found) == 1 and len(found[0].dimensions) == 1 else None
    if (
        first is None
        or first.end is None
        or first.unit not in kind.aws_units
        or (first.begin, first.usd) != ("0", "0")
    ):
        raise PricingError(f"franquia ausente ou fora do formato: {sku}")
    return FreeTier(quantity=first.end, pool=kind.pool)


def _price(products: Sequence[Product], region: str, sku: str) -> Price | None:
    group, description, kind = _SKUS[sku]
    found = _select(products, region, group)
    if len(found) > 1:
        raise PricingError(f"mais de um produto da AWS: {sku}")
    if not found:
        return None
    price_tiers = tiers(found[0].dimensions)
    if found[0].dimensions[0].unit not in kind.aws_units:
        raise PricingError(f"unidade da AWS inesperada: {sku}")
    # Zero sai sempre "0" (`decimal_text`); 1ª faixa grátis seria a franquia contada duas vezes.
    if price_tiers[0].unit_price == "0":
        raise PricingError(f"primeira faixa sem preço: {sku}")
    return Price(sku, description, kind.unit, price_tiers, _free_tier(products, sku, kind))


def build(region: str, products: Sequence[Product]) -> tuple[Price, ...]:
    """SKUs do conjunto fechado; o resto é ignorado e SKU sem produto não sai (`expected_skus`)."""
    prices = (_price(products, region, sku) for sku in _SKUS)
    return tuple(price for price in prices if price is not None)


SERVICE = ServiceSpec(
    slug="lambda", service_code=_CODE, queries=queries, build=build, expected_skus=frozenset(_SKUS)
)
