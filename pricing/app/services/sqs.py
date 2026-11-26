"""SQS (`aws.sqs`): requisições das filas padrão e FIFO, que dividem a franquia mensal global.

Fora: fila Fair, a contagem de requisições por blocos de 64 KB de carga e a transferência de dados.
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

_CODE = "AWSQueueService"
_UNITS = frozenset({"Requests", "Request"})
# Produto global da franquia e o pool que os dois tipos de fila dividem.
_FREE_USAGETYPE, _FREE_GROUP, _POOL = "Global-Requests", "SQS-APIRequest-Tier1", "sqs-requests"
# Conjunto fechado: SKU do catálogo -> (queueType do produto regional da AWS, descrição).
_SKUS: Mapping[str, tuple[str, str]] = {
    "sqs-requests-standard": ("Standard", "Requisições (fila padrão)"),
    "sqs-requests-fifo": ("FIFO (first-in, first-out)", "Requisições (fila FIFO)"),
}


def queries(region: str) -> tuple[Query, ...]:
    """Uma consulta por tipo de fila na região e uma para a franquia, que é global."""
    regional = tuple(
        Query(_CODE, (region_filter(region), Filter("queueType", q))) for q, _ in _SKUS.values()
    )
    free = Query(_CODE, (Filter("usagetype", _FREE_USAGETYPE), Filter("group", _FREE_GROUP)))
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
    found = _select(products, "", usagetype=_FREE_USAGETYPE, group=_FREE_GROUP)
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
    queue, description = _SKUS[sku]
    found = _select(products, region, queueType=queue)
    if len(found) > 1:
        raise PricingError(f"mais de um produto da AWS: {sku}")
    if not found:
        return None
    if any(d.unit not in _UNITS for d in found[0].dimensions):
        raise PricingError(f"unidade da AWS inesperada: {sku}")
    price_tiers = tiers(found[0].dimensions)
    # Zero sai sempre "0" (`decimal_text`); 1ª faixa grátis contaria a franquia duas vezes.
    if price_tiers[0].unit_price == "0":
        raise PricingError(f"primeira faixa sem preço: {sku}")
    return Price(sku, description, "request", price_tiers, free)


def build(region: str, products: Sequence[Product]) -> tuple[Price, ...]:
    """Franquia uma vez, mesmo sem produto regional; SKU sem produto não sai."""
    free = _free_tier(products)
    prices = (_price(products, region, sku, free) for sku in _SKUS)
    return tuple(price for price in prices if price is not None)


SERVICE = ServiceSpec(
    slug="sqs", service_code=_CODE, queries=queries, build=build, expected_skus=frozenset(_SKUS)
)
