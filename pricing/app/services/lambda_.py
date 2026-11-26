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
    unit="request",
    aws_units=frozenset({"Requests", "Request"}),
    free_usagetype="Global-Request",
    free_group="AWS-Lambda-Requests",
    pool="lambda-requests",
)
_DURATION = _Kind(
    unit="GB-second",
    aws_units=frozenset({"Lambda-GB-Second"}),
    free_usagetype="Global-Lambda-GB-Second",
    free_group="AWS-Lambda-Duration",
    pool="lambda-duration",
)
# Conjunto fechado: SKU do catálogo -> (group do produto regional da AWS, descrição, tipo).
_SKUS: Mapping[str, tuple[str, str, _Kind]] = {
    "lambda-requests-x86": ("AWS-Lambda-Requests", "Requisições (x86)", _REQUESTS),
    "lambda-requests-arm64": ("AWS-Lambda-Requests-ARM", "Requisições (arm64)", _REQUESTS),
    "lambda-duration-x86": ("AWS-Lambda-Duration", "Duração (x86)", _DURATION),
    "lambda-duration-arm64": ("AWS-Lambda-Duration-ARM", "Duração (arm64)", _DURATION),
}


def queries(region: str) -> tuple[Query, ...]:
    """Uma consulta por group na região e uma por franquia, que é global."""
    regional = tuple(
        Query(_CODE, (region_filter(region), Filter("group", g))) for g, _, _ in _SKUS.values()
    )
    free = tuple(
        Query(_CODE, (Filter("usagetype", k.free_usagetype), Filter("group", k.free_group)))
        for k in (_REQUESTS, _DURATION)
    )
    return (*regional, *free)


def _select(products: Sequence[Product], region: str, **attributes: str) -> list[Product]:
    """Da região e com os atributos; `region` vazio é o global (`regionCode` vazio ou ausente)."""
    return [
        p
        for p in products
        if p.attributes.get("regionCode", "") == region
        and all(p.attributes.get(k) == v for k, v in attributes.items())
    ]


def _free_tier(products: Sequence[Product], kind: _Kind) -> FreeTier:
    """Franquia do único produto global: uma faixa grátis a partir de zero com fim finito."""
    message = f"franquia ausente ou fora do formato: {kind.pool}"
    found = _select(products, "", usagetype=kind.free_usagetype, group=kind.free_group)
    if len(found) != 1 or len(found[0].dimensions) != 1:
        raise PricingError(message)
    (dimension,) = found[0].dimensions
    if dimension.unit not in kind.aws_units or dimension.end is None:
        raise PricingError(message)
    # `decimal_text` já normalizou zero para "0".
    if (dimension.begin, dimension.usd) != ("0", "0"):
        raise PricingError(message)
    return FreeTier(quantity=dimension.end, pool=kind.pool)


def _price(products: Sequence[Product], region: str, sku: str, free: FreeTier) -> Price | None:
    group, description, kind = _SKUS[sku]
    found = _select(products, region, group=group)
    if len(found) > 1:
        raise PricingError(f"mais de um produto da AWS: {sku}")
    if not found:
        return None
    if any(d.unit not in kind.aws_units for d in found[0].dimensions):
        raise PricingError(f"unidade da AWS inesperada: {sku}")
    price_tiers = tiers(found[0].dimensions)
    # Zero sai sempre "0" (`decimal_text`); 1ª faixa grátis contaria a franquia duas vezes.
    if price_tiers[0].unit_price == "0":
        raise PricingError(f"primeira faixa sem preço: {sku}")
    return Price(sku, description, kind.unit, price_tiers, free)


def build(region: str, products: Sequence[Product]) -> tuple[Price, ...]:
    """Franquia uma vez por tipo, mesmo sem produto regional; SKU sem produto não sai."""
    free = {kind: _free_tier(products, kind) for kind in (_REQUESTS, _DURATION)}
    prices = (_price(products, region, sku, free[kind]) for sku, (_, _, kind) in _SKUS.items())
    return tuple(price for price in prices if price is not None)


SERVICE = ServiceSpec(
    slug="lambda", service_code=_CODE, queries=queries, build=build, expected_skus=frozenset(_SKUS)
)
