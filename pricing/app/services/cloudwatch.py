"""CloudWatch (`aws.cloudwatch`): ingestão de logs (Standard), armazenamento de logs, métricas
customizadas e alarmes de resolução padrão, cada um com a sua franquia mensal global.

Fora: logs Infrequent Access, vended logs (gerados por serviços da AWS), Logs Insights (dados
escaneados), alarmes de alta resolução e compostos, dashboards, canaries, Contributor Insights,
requisições de API e Metric Streams.

Franquia: como na Lambda, vem de um produto global (sem `regionCode`), um por SKU, sem pool.
Mensagens de erro levam só o SKU do catálogo, nunca texto da AWS.
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

_CODE = "AmazonCloudWatch"


@dataclass(frozen=True, slots=True)
class _Sku:
    """Atributos do produto regional, unidades e o produto global da franquia."""

    attributes: Mapping[str, str]
    aws_unit: str
    unit: str
    description: str
    free_usagetype: str
    free_group: str


# Conjunto fechado, na ordem das consultas; os atributos seguem a ordem dos filtros.
_SKUS: Mapping[str, _Sku] = {
    "cloudwatch-logs-ingestion": _Sku(
        attributes={
            "group": "Ingested Logs",
            "groupDescription": "Existing system, application, and custom log files",
            "version": "Current",
        },
        aws_unit="GB",
        unit="GB",
        description="Ingestão de logs (Standard)",
        free_usagetype="Global-DataProcessing-Bytes",
        free_group="CW-MonthlyFree-DataProcessing",
    ),
    "cloudwatch-logs-storage": _Sku(
        attributes={"group": "Amazon CloudWatch Standard Storage pricing current"},
        aws_unit="GB-Mo",
        unit="GB-month",
        description="Armazenamento de logs",
        free_usagetype="Global-TimedStorage-ByteHrs",
        free_group="CW-MonthlyFree-Archival",
    ),
    "cloudwatch-custom-metrics": _Sku(
        attributes={"group": "Metric", "groupDescription": "CloudWatch Custom Metrics"},
        aws_unit="Metrics",
        unit="metric-month",
        description="Métricas customizadas",
        free_usagetype="Global-CW:MetricMonitorUsage",
        free_group="CW-MonthlyFree-Metric",
    ),
    "cloudwatch-alarms": _Sku(
        attributes={"group": "Alarm", "alarmType": "Standard"},
        aws_unit="Alarms",
        unit="alarm-month",
        description="Alarmes (resolução padrão)",
        free_usagetype="Global-CW:AlarmMonitorUsage",
        free_group="CW-MonthlyFree-Alarm",
    ),
}


def queries(region: str) -> tuple[Query, ...]:
    """Uma consulta por SKU na região e depois uma por franquia, que é global."""
    regional = tuple(
        Query(_CODE, (region_filter(region), *(Filter(k, v) for k, v in s.attributes.items())))
        for s in _SKUS.values()
    )
    free = tuple(
        Query(_CODE, (Filter("usagetype", s.free_usagetype), Filter("group", s.free_group)))
        for s in _SKUS.values()
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


def _free_tier(products: Sequence[Product], sku: str) -> FreeTier:
    """Franquia do único produto global: uma faixa grátis a partir de zero com fim finito."""
    spec = _SKUS[sku]
    message = f"franquia ausente ou fora do formato: {sku}"
    found = _select(products, "", usagetype=spec.free_usagetype, group=spec.free_group)
    if len(found) != 1 or len(found[0].dimensions) != 1:
        raise PricingError(message)
    (dimension,) = found[0].dimensions
    if dimension.unit != spec.aws_unit or dimension.end is None:
        raise PricingError(message)
    # `decimal_text` já normalizou zero para "0".
    if (dimension.begin, dimension.usd) != ("0", "0"):
        raise PricingError(message)
    return FreeTier(quantity=dimension.end)


def _price(products: Sequence[Product], region: str, sku: str, free: FreeTier) -> Price | None:
    spec = _SKUS[sku]
    found = _select(products, region, **spec.attributes)
    if len(found) > 1:
        raise PricingError(f"mais de um produto da AWS: {sku}")
    if not found:
        return None
    if any(d.unit != spec.aws_unit for d in found[0].dimensions):
        raise PricingError(f"unidade da AWS inesperada: {sku}")
    price_tiers = tiers(found[0].dimensions)
    # Zero sai sempre "0" (`decimal_text`); 1ª faixa grátis contaria a franquia duas vezes.
    if price_tiers[0].unit_price == "0":
        raise PricingError(f"primeira faixa sem preço: {sku}")
    return Price(sku, spec.description, spec.unit, price_tiers, free)


def build(region: str, products: Sequence[Product]) -> tuple[Price, ...]:
    """Franquias primeiro, mesmo sem produto regional; SKU sem produto não sai."""
    free = {sku: _free_tier(products, sku) for sku in _SKUS}
    prices = (_price(products, region, sku, free[sku]) for sku in _SKUS)
    return tuple(price for price in prices if price is not None)


SERVICE = ServiceSpec(
    slug="cloudwatch",
    service_code=_CODE,
    queries=queries,
    build=build,
    expected_skus=frozenset(_SKUS),
)
