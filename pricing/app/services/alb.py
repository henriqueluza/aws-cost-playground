"""ALB (`aws.alb`): hora do Application Load Balancer e LCU-hora usada.

Fora: LCU reservada, trust store (mTLS), ALB em Outposts, a franquia de 12 meses de conta nova e
os outros tipos de balanceador (Classic, Network, Gateway), que dividem o `usagetype` mas não a
`operation`. Mensagens de erro levam só o SKU do catálogo, nunca texto da AWS.
"""

from collections.abc import Mapping, Sequence

from app.model import Filter, Price, PricingError, Product, Query, ServiceSpec, region_filter
from app.products import tiers

_CODE = "AWSELB"
_OPERATION = "LoadBalancing:Application"
# Prefixo regional do `usagetype` na AWS: us-east-1 não tem; as outras regiões, sim.
_USAGE_PREFIX: Mapping[str, str] = {"us-east-1": "", "sa-east-1": "SAE1-"}
# Conjunto fechado: SKU do catálogo -> (usagetype sem prefixo, unidade AWS, unidade, descrição).
_SKUS: Mapping[str, tuple[str, str, str, str]] = {
    "alb-hours": ("LoadBalancerUsage", "Hrs", "hour", "Horas do balanceador"),
    "alb-lcu-hours": ("LCUUsage", "LCU-Hrs", "LCU-hour", "LCU-hora usadas"),
}


def _prefix(region: str) -> str:
    """Prefixo do `usagetype` na região; região fora do mapa é erro."""
    prefix = _USAGE_PREFIX.get(region)
    if prefix is None:
        raise PricingError("região fora do catálogo")
    return prefix


def queries(region: str) -> tuple[Query, ...]:
    """Uma consulta por SKU: `regionCode`, `operation` e `usagetype` com o prefixo da região."""
    prefix, common = _prefix(region), (region_filter(region), Filter("operation", _OPERATION))
    return tuple(
        Query(_CODE, (*common, Filter("usagetype", prefix + usagetype)))
        for usagetype, *_ in _SKUS.values()
    )


def _select(products: Sequence[Product], region: str, **attributes: str) -> list[Product]:
    """Produtos da região com todos os atributos iguais: o TERM_MATCH refeito sobre a resposta."""
    return [
        p
        for p in products
        if p.attributes.get("regionCode", "") == region
        and all(p.attributes.get(k) == v for k, v in attributes.items())
    ]


def _price(products: Sequence[Product], region: str, prefix: str, sku: str) -> Price | None:
    usagetype, aws_unit, unit, description = _SKUS[sku]
    found = _select(products, region, operation=_OPERATION, usagetype=prefix + usagetype)
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
    return Price(sku, description, unit, price_tiers)


def build(region: str, products: Sequence[Product]) -> tuple[Price, ...]:
    """Um preço por SKU com produto na região, sem franquia; SKU sem produto não sai."""
    prefix = _prefix(region)
    prices = (_price(products, region, prefix, sku) for sku in _SKUS)
    return tuple(price for price in prices if price is not None)


SERVICE = ServiceSpec(
    slug="alb", service_code=_CODE, queries=queries, build=build, expected_skus=frozenset(_SKUS)
)
