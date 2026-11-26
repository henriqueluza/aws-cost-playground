"""WAF (`aws.waf`), WAFv2 regional: web ACLs e regras por mês e requisições inspecionadas no
nível padrão (Tier1).

Fora: requisições Tier0 e Tier2..8 (por WCU acima de 1.500), inspeção de corpo acima do padrão
(32/48/64 KB), WAF Classic, escopo CloudFront (global), Shield, Bot Control, Fraud Control,
Anti-DDoS, CAPTCHA e Challenge e regras do Marketplace.

Sem franquia e com faixa única. Mensagens de erro levam só o SKU do catálogo, nunca texto da AWS.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from app.model import (
    Filter,
    Price,
    PricingError,
    Product,
    Query,
    ServiceSpec,
    region_filter,
)
from app.products import tiers

_CODE = "awswaf"


@dataclass(frozen=True, slots=True)
class _Sku:
    """Atributos que filtram a consulta e selecionam o produto, e as unidades."""

    attributes: Mapping[str, str]
    aws_unit: str
    unit: str
    description: str


# Conjunto fechado, na ordem das consultas; o `groupDescription` separa o WAFv2 do Classic.
_SKUS: Mapping[str, _Sku] = {
    "waf-web-acls": _Sku(
        attributes={"group": "Web ACL", "groupDescription": "Web ACL Activated"},
        aws_unit="Month",
        unit="web ACL-month",
        description="Web ACLs",
    ),
    "waf-rules": _Sku(
        attributes={"group": "Rule", "groupDescription": "Rule Activated"},
        aws_unit="Month",
        unit="rule-month",
        description="Regras das web ACLs",
    ),
    "waf-requests": _Sku(
        attributes={"group": "Request", "groupDescription": "Request Processed Tier1"},
        aws_unit="Request",
        unit="request",
        description="Requisições inspecionadas",
    ),
}


def queries(region: str) -> tuple[Query, ...]:
    """Uma consulta por SKU na região, com os atributos que separam o produto."""
    return tuple(
        Query(_CODE, (region_filter(region), *(Filter(k, v) for k, v in s.attributes.items())))
        for s in _SKUS.values()
    )


def _select(products: Sequence[Product], region: str, **attributes: str) -> list[Product]:
    """Produtos da região com todos os atributos iguais: o TERM_MATCH refeito sobre a resposta."""
    return [
        p
        for p in products
        if p.attributes.get("regionCode", "") == region
        and all(p.attributes.get(k) == v for k, v in attributes.items())
    ]


def _price(products: Sequence[Product], region: str, sku: str) -> Price | None:
    spec = _SKUS[sku]
    found = _select(products, region, **spec.attributes)
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
    """Um preço por SKU com produto na região; SKU sem produto não sai."""
    prices = (_price(products, region, sku) for sku in _SKUS)
    return tuple(price for price in prices if price is not None)


SERVICE = ServiceSpec(
    slug="waf", service_code=_CODE, queries=queries, build=build, expected_skus=frozenset(_SKUS)
)
