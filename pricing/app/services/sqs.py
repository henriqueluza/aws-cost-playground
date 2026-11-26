"""SQS (`aws.sqs`): requisições das filas padrão e FIFO, que dividem a franquia mensal global.

Fica fora: fila Fair, a contagem de requisições por blocos de 64 KB de carga e a transferência
de dados.
"""

from collections.abc import Sequence

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
_POOL = "sqs-requests"
_UNITS = frozenset({"Requests", "Request"})
_FREE_TIER_USAGE = "Global-Requests"
_NO_FREE_TIER = "franquia do SQS ausente ou fora do formato"
# SKU do catálogo -> (queueType da AWS, descrição). Só estes produtos entram no arquivo.
_SKUS = {
    "sqs-requests-standard": ("Standard", "Requisições (fila padrão)"),
    "sqs-requests-fifo": ("FIFO (first-in, first-out)", "Requisições (fila FIFO)"),
}


def queries(region: str) -> tuple[Query, ...]:
    """Uma consulta por tipo de fila na região e uma para a franquia, que é global."""
    regional = tuple(
        Query(_CODE, (region_filter(region), Filter("queueType", queue)))
        for queue, _ in _SKUS.values()
    )
    return (*regional, Query(_CODE, (Filter("usagetype", _FREE_TIER_USAGE),)))


def _free_tier(products: Sequence[Product]) -> FreeTier:
    """Franquia do único produto global: uma faixa grátis a partir de zero com fim finito."""
    found = [
        p
        for p in products
        if p.attributes.get("regionCode", "") == ""
        and p.attributes.get("usagetype") == _FREE_TIER_USAGE
    ]
    if len(found) != 1 or len(found[0].dimensions) != 1:
        raise PricingError(_NO_FREE_TIER)
    (dimension,) = found[0].dimensions
    # `decimal_text` já normalizou zero para "0".
    begin_and_price = (dimension.begin, dimension.usd)
    if dimension.unit not in _UNITS or begin_and_price != ("0", "0") or dimension.end is None:
        raise PricingError(_NO_FREE_TIER)
    return FreeTier(quantity=dimension.end, pool=_POOL)


def _price(sku: str, region: str, products: Sequence[Product], free: FreeTier) -> Price | None:
    """Preço do tipo de fila na região; None se a AWS não devolveu o produto."""
    queue, description = _SKUS[sku]
    found = [
        p
        for p in products
        if p.attributes.get("regionCode") == region and p.attributes.get("queueType") == queue
    ]
    if not found:
        return None
    if len(found) > 1:
        raise PricingError(f"mais de um produto para {sku}")
    if any(d.unit not in _UNITS for d in found[0].dimensions):
        raise PricingError(f"unidade fora do conjunto em {sku}")
    price_tiers = tiers(found[0].dimensions)
    # Faixa grátis embutida somaria à franquia e contaria duas vezes.
    if price_tiers[0].unit_price == "0":
        raise PricingError(f"primeira faixa com preço zero em {sku}")
    return Price(sku, description, "request", price_tiers, free)


def build(region: str, products: Sequence[Product]) -> tuple[Price, ...]:
    """Um `Price` por tipo de fila devolvido; produto fora da tabela é ignorado."""
    free = _free_tier(products)
    prices = (_price(sku, region, products, free) for sku in _SKUS)
    return tuple(p for p in prices if p is not None)


SERVICE = ServiceSpec(
    slug="sqs",
    service_code=_CODE,
    queries=queries,
    build=build,
    expected_skus=frozenset(_SKUS),
)
