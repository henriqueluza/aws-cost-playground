"""CloudTrail (`aws.cloudtrail`): eventos de gerenciamento das cópias adicionais e eventos de dados.

Uma consulta por `usagetype`, com o prefixo da região (`USE1-` também em us-east-1). O `build` só
aceita o produto que casa família, `usagetype` e `regionCode`; o resto da resposta é ignorado.
Ficam fora o CloudTrail Insights, o CloudTrail Lake, os eventos de rede, o armazenamento dos logs
no S3 e o produto `FreeEventsRecorded`, de preço 0: a 1ª cópia grátis dos eventos de gerenciamento
é modelada na função de preço do bloco, que só cobra as cópias das trilhas adicionais.
"""

from collections.abc import Sequence
from dataclasses import dataclass

from app.model import Filter, Price, PricingError, Product, Query, ServiceSpec, region_filter
from app.products import tiers

_PREFIX = {"us-east-1": "USE1-", "sa-east-1": "SAE1-"}
_CODE = "AWSCloudTrail"
_AWS_UNIT, _UNIT = "Events", "event"


@dataclass(frozen=True, slots=True)
class _Item:
    """SKU do catálogo e o produto que o define; `usagetype` sem o prefixo da região."""

    sku: str
    family: str
    usagetype: str
    description: str


# Conjunto fechado, na ordem das consultas.
_ITEMS = (
    _Item(
        "cloudtrail-management-events",
        "Management Tools - AWS CloudTrail Paid Events Recorded",
        "PaidEventsRecorded",
        "Eventos de gerenciamento (cópias adicionais)",
    ),
    _Item(
        "cloudtrail-data-events",
        "Management Tools - AWS CloudTrail Data Events Recorded",
        "DataEventsRecorded",
        "Eventos de dados",
    ),
)


def _prefix(region: str) -> str:
    prefix = _PREFIX.get(region)
    if prefix is None:
        raise PricingError("região sem prefixo de usagetype do CloudTrail")
    return prefix


def queries(region: str) -> tuple[Query, ...]:
    """Uma consulta por `usagetype`, na ordem dos itens."""
    prefix = _prefix(region)
    return tuple(
        Query(_CODE, (region_filter(region), Filter("usagetype", prefix + item.usagetype)))
        for item in _ITEMS
    )


def _pick(item: _Item, region: str, prefix: str, products: Sequence[Product]) -> Product | None:
    """O único produto que casa exatamente com o item; None se nenhum casar."""
    found = [
        p
        for p in products
        if p.family == item.family
        and p.attributes.get("usagetype") == prefix + item.usagetype
        and p.attributes.get("regionCode") == region
    ]
    if len(found) > 1:
        raise PricingError(f"mais de um produto da AWS: {item.sku}")
    return found[0] if found else None


def _price(item: _Item, product: Product) -> Price:
    """Preço do item; recusa outra unidade (preço por 1.000 eventos daria custo 1.000x)."""
    if any(d.unit != _AWS_UNIT for d in product.dimensions):
        raise PricingError(f"unidade da AWS inesperada: {item.sku}")
    price_tiers = tiers(product.dimensions)
    # Zero sai sempre "0" (`decimal_text`); 1ª faixa grátis contaria a cópia grátis duas vezes.
    if price_tiers[0].unit_price == "0":
        raise PricingError(f"primeira faixa sem preço: {item.sku}")
    return Price(item.sku, item.description, _UNIT, price_tiers)


def build(region: str, products: Sequence[Product]) -> tuple[Price, ...]:
    """Preços dos itens encontrados; item sem produto fica fora e o `blocking` acusa."""
    prefix = _prefix(region)
    picked = [(item, _pick(item, region, prefix, products)) for item in _ITEMS]
    return tuple(_price(item, product) for item, product in picked if product is not None)


SERVICE = ServiceSpec(
    slug="cloudtrail",
    service_code=_CODE,
    queries=queries,
    build=build,
    expected_skus=frozenset(item.sku for item in _ITEMS),
)
