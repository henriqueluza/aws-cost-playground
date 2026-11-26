"""CodePipeline (`aws.codepipeline`): pipelines ativos (V1) e minutos de execução de ações (V2).

Uma consulta por `usagetype` na região, com o prefixo dela (`USE1-`, `SAE1-`), e uma por franquia
mensal, que vem do produto global (`Global-<usagetype>`, `regionCode` vazio ou ausente). O `build`
só aceita o produto que casa família, `usagetype` e `regionCode`; o resto é ignorado. Fora: os 30
dias grátis de pipeline novo (`trialPipeline`, mesma família e preço 0), que são temporários, e as
cobranças dos outros serviços que as ações usam (ex.: CodeBuild, S3, Lambda).
"""

from collections.abc import Sequence
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

_CODE = "AWSCodePipeline"
_PREFIX = {"us-east-1": "USE1-", "sa-east-1": "SAE1-"}
_GLOBAL = "Global-"


@dataclass(frozen=True, slots=True)
class _Item:
    """SKU do catálogo e o produto que o define; `usagetype` sem o prefixo da região."""

    sku: str
    family: str
    usagetype: str
    aws_unit: str
    unit: str
    description: str


# Conjunto fechado, na ordem das consultas.
_ITEMS = (
    _Item(
        "codepipeline-active-pipelines",
        "Active Pipeline",
        "activePipeline",
        "pipelines",
        "pipeline-month",
        "Pipelines ativos (V1)",
    ),
    _Item(
        "codepipeline-action-minutes",
        "Action Execution Minutes",
        "actionExecutionMinute",
        "minutes",
        "minute",
        "Minutos de execução de ações (V2)",
    ),
)


def _prefix(region: str) -> str:
    prefix = _PREFIX.get(region)
    if prefix is None:
        raise PricingError("região sem prefixo de usagetype do CodePipeline")
    return prefix


def queries(region: str) -> tuple[Query, ...]:
    """Uma consulta por `usagetype` na região e uma por franquia, que é global."""
    prefix = _prefix(region)
    regional = tuple(
        Query(_CODE, (region_filter(region), Filter("usagetype", prefix + item.usagetype)))
        for item in _ITEMS
    )
    free = tuple(Query(_CODE, (Filter("usagetype", _GLOBAL + item.usagetype),)) for item in _ITEMS)
    return (*regional, *free)


def _select(item: _Item, region: str, usagetype: str, products: Sequence[Product]) -> list[Product]:
    """Da família do item, com o `usagetype` e da região; `region` vazio é o global."""
    return [
        p
        for p in products
        if p.family == item.family
        and p.attributes.get("usagetype") == usagetype
        and p.attributes.get("regionCode", "") == region
    ]


def _free_tier(item: _Item, products: Sequence[Product]) -> FreeTier:
    """Franquia do único produto global: uma faixa grátis a partir de zero com fim finito."""
    message = f"franquia ausente ou fora do formato: {item.sku}"
    found = _select(item, "", _GLOBAL + item.usagetype, products)
    if len(found) != 1 or len(found[0].dimensions) != 1:
        raise PricingError(message)
    (dimension,) = found[0].dimensions
    if dimension.unit != item.aws_unit or dimension.end is None:
        raise PricingError(message)
    # `decimal_text` já normalizou zero para "0".
    if (dimension.begin, dimension.usd) != ("0", "0"):
        raise PricingError(message)
    return FreeTier(quantity=dimension.end)


def _price(
    item: _Item, region: str, prefix: str, products: Sequence[Product], free: FreeTier
) -> Price | None:
    found = _select(item, region, prefix + item.usagetype, products)
    if len(found) > 1:
        raise PricingError(f"mais de um produto da AWS: {item.sku}")
    if not found:
        return None
    if any(d.unit != item.aws_unit for d in found[0].dimensions):
        raise PricingError(f"unidade da AWS inesperada: {item.sku}")
    price_tiers = tiers(found[0].dimensions)
    # Zero sai sempre "0" (`decimal_text`); 1ª faixa grátis contaria a franquia duas vezes.
    if price_tiers[0].unit_price == "0":
        raise PricingError(f"primeira faixa sem preço: {item.sku}")
    return Price(item.sku, item.description, item.unit, price_tiers, free)


def build(region: str, products: Sequence[Product]) -> tuple[Price, ...]:
    """Franquias primeiro, mesmo sem produto regional; SKU sem produto regional não sai."""
    prefix = _prefix(region)
    free = [_free_tier(item, products) for item in _ITEMS]
    prices = (
        _price(item, region, prefix, products, item_free)
        for item, item_free in zip(_ITEMS, free, strict=True)
    )
    return tuple(price for price in prices if price is not None)


SERVICE = ServiceSpec(
    slug="codepipeline",
    service_code=_CODE,
    queries=queries,
    build=build,
    expected_skus=frozenset(item.sku for item in _ITEMS),
)
