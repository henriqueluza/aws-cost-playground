"""Transferência de dados (custos de aresta, #42): saída para a internet e tráfego entre zonas.

Não é um bloco: o motor cobra estes SKUs pelas arestas `data`. A saída das bordas do CloudFront
tem tabela própria e fica em `cloudfront.py`.

- `data-transfer-internet-out`: saída da região para a internet. A AWS soma o volume de todos os
  serviços da conta (EC2, S3, ALB...) nas faixas e dá uma franquia mensal única, publicada como
  um produto global.
- `data-transfer-inter-az`: tráfego entre zonas da mesma região, cobrado por GB em cada direção.
  A Price List publica também um produto global de 1 GB grátis para ele, que fica fora: não
  consta como franquia permanente na página de preços e sem ele o custo nunca sai subestimado.

Fora: tráfego entre regiões, IP público, aceleração e o que sai pelo NAT Gateway.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from app.model import Filter, FreeTier, Price, PricingError, Product, Query, ServiceSpec
from app.products import tiers

_CODE = "AWSDataTransfer"
_FAMILY = "Data Transfer"
_UNIT = "GB"
_OUT, _INTER_AZ = "data-transfer-internet-out", "data-transfer-inter-az"
# Produto global (sem região) da franquia de saída para a internet.
_FREE = {"usagetype": "Global-DataTransfer-Out-Bytes", "transferType": "AWS Outbound"}


@dataclass(frozen=True, slots=True)
class _Sku:
    """Produto regional da AWS (pelos atributos, além da região de origem) e o texto do catálogo."""

    attributes: Mapping[str, str]
    to_region: bool
    description: str


# Conjunto fechado: SKU do catálogo -> produto, na ordem das consultas e dos preços.
_SKUS: Mapping[str, _Sku] = {
    _OUT: _Sku(
        attributes={"transferType": "AWS Outbound", "toLocation": "External"},
        to_region=False,
        description="Saída da região para a internet",
    ),
    _INTER_AZ: _Sku(
        attributes={"transferType": "IntraRegion"},
        to_region=True,
        description="Tráfego entre zonas de disponibilidade, por direção",
    ),
}


def _wanted(region: str, spec: _Sku) -> dict[str, str]:
    """Atributos que identificam o produto regional; o destino é a própria região só entre zonas."""
    wanted = {"fromRegionCode": region, **spec.attributes}
    return {**wanted, "toRegionCode": region} if spec.to_region else wanted


def queries(region: str) -> tuple[Query, ...]:
    """Uma consulta por SKU na região e uma para a franquia de saída, que é global."""
    regional = tuple(
        Query(_CODE, tuple(Filter(k, v) for k, v in _wanted(region, spec).items()))
        for spec in _SKUS.values()
    )
    return (*regional, Query(_CODE, tuple(Filter(k, v) for k, v in _FREE.items())))


def _select(products: Sequence[Product], wanted: Mapping[str, str]) -> list[Product]:
    return [
        p
        for p in products
        if p.family == _FAMILY and all(p.attributes.get(k) == v for k, v in wanted.items())
    ]


def _free_tier(products: Sequence[Product]) -> FreeTier:
    """Franquia do único produto global: uma faixa grátis a partir de zero com fim finito."""
    message = f"franquia ausente ou fora do formato: {_OUT}"
    # No produto global a região de origem vem vazia (ou ausente).
    found = [p for p in _select(products, _FREE) if not p.attributes.get("fromRegionCode")]
    if len(found) != 1 or len(found[0].dimensions) != 1:
        raise PricingError(message)
    (dimension,) = found[0].dimensions
    # `decimal_text` já normalizou zero para "0".
    if (dimension.unit, dimension.begin, dimension.usd) != (_UNIT, "0", "0"):
        raise PricingError(message)
    if dimension.end is None:
        raise PricingError(message)
    return FreeTier(quantity=dimension.end)


def _price(products: Sequence[Product], region: str, sku: str, free: FreeTier) -> Price | None:
    spec = _SKUS[sku]
    found = _select(products, _wanted(region, spec))
    if len(found) > 1:
        raise PricingError(f"mais de um produto da AWS: {sku}")
    if not found:
        return None
    if any(d.unit != _UNIT for d in found[0].dimensions):
        raise PricingError(f"unidade da AWS inesperada: {sku}")
    # Zero sai sempre "0" (`decimal_text`); faixa grátis contaria a franquia duas vezes.
    if any(d.usd == "0" for d in found[0].dimensions):
        raise PricingError(f"faixa sem preço: {sku}")
    return Price(
        sku,
        spec.description,
        _UNIT,
        tiers(found[0].dimensions),
        free if sku == _OUT else None,
    )


def build(region: str, products: Sequence[Product]) -> tuple[Price, ...]:
    """Franquia exigida sempre; SKU sem produto não sai e sobra para `expected_skus`."""
    free = _free_tier(products)
    prices = (_price(products, region, sku, free) for sku in _SKUS)
    return tuple(price for price in prices if price is not None)


SERVICE = ServiceSpec(
    slug="data-transfer",
    service_code=_CODE,
    queries=queries,
    build=build,
    expected_skus=frozenset(_SKUS),
)
