"""Route 53 (`aws.route53`): zonas hospedadas e consultas DNS padrão.

Primeiro serviço só global: a AWS publica zona e consultas padrão sem região (`regionCode`
vazio), com as mesmas faixas nas duas regiões. Por isso `queries` e `build` ignoram a região.

Fora: consultas alias para recursos da AWS (grátis), roteamento por latência, geolocalização,
geoproximidade e IP, health checks, Traffic Flow, Resolver, DNS Firewall, Profiles, registros
acima de 10.000 por zona e domínios. Sem franquia.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from app.model import Filter, Price, PricingError, Product, Query, ServiceSpec
from app.products import tiers

_CODE = "AmazonRoute53"


@dataclass(frozen=True, slots=True)
class _Sku:
    """`usagetype` que filtra a consulta e seleciona o produto global, e as unidades."""

    usagetype: str
    aws_unit: str
    unit: str
    description: str


# Conjunto fechado, na ordem das consultas.
_SKUS: Mapping[str, _Sku] = {
    "route53-hosted-zones": _Sku(
        usagetype="HostedZone",
        aws_unit="HostedZone",
        unit="hosted zone-month",
        description="Zonas hospedadas",
    ),
    "route53-queries": _Sku(
        usagetype="DNS-Queries",
        aws_unit="Queries",
        unit="query",
        description="Consultas DNS padrão",
    ),
}


def queries(region: str) -> tuple[Query, ...]:
    """Uma consulta por SKU pelo `usagetype` do produto global; a região não entra."""
    return tuple(Query(_CODE, (Filter("usagetype", s.usagetype),)) for s in _SKUS.values())


def _select(products: Sequence[Product], usagetype: str) -> list[Product]:
    """Globais (`regionCode` vazio ou ausente) com o `usagetype` exato: o TERM_MATCH refeito."""
    return [
        p
        for p in products
        if p.attributes.get("regionCode", "") == "" and p.attributes.get("usagetype") == usagetype
    ]


def _price(products: Sequence[Product], sku: str) -> Price | None:
    spec = _SKUS[sku]
    found = _select(products, spec.usagetype)
    if len(found) > 1:
        raise PricingError(f"mais de um produto da AWS: {sku}")
    if not found:
        return None
    if any(d.unit != spec.aws_unit for d in found[0].dimensions):
        raise PricingError(f"unidade da AWS inesperada: {sku}")
    price_tiers = tiers(found[0].dimensions)
    # Zero sai sempre "0" (`decimal_text`); faixa grátis aqui seria franquia não declarada.
    if price_tiers[0].unit_price == "0":
        raise PricingError(f"primeira faixa sem preço: {sku}")
    return Price(sku, spec.description, spec.unit, price_tiers)


def build(region: str, products: Sequence[Product]) -> tuple[Price, ...]:
    """Um preço por SKU com produto global, qualquer que seja a região; SKU sem produto não sai."""
    prices = (_price(products, sku) for sku in _SKUS)
    return tuple(price for price in prices if price is not None)


SERVICE = ServiceSpec(
    slug="route53",
    service_code=_CODE,
    queries=queries,
    build=build,
    expected_skus=frozenset(_SKUS),
)
