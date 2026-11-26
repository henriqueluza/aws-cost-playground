"""CloudFront (`aws.cloudfront`): requisições HTTPS e saída para a internet.

O preço do CloudFront depende de onde está quem acessa (o local de borda que atende), não da
região da origem, e a Price List dele é global: `region_filter` não serve. Usamos as bordas do
continente da região do design, filtradas pelo `usagetype`. A franquia permanente (1 TB de
saída e 10 milhões de requisições por mês) não vem na Price List: o `build` a acrescenta e
recusa qualquer faixa com preço zero, que a contaria duas vezes.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from app.model import Filter, FreeTier, Price, PricingError, Product, Query, ServiceSpec
from app.products import tiers

_CODE = "AmazonCloudFront"
_EDGE = {"us-east-1": "US", "sa-east-1": "SA"}
_EDGE_NAME = {"US": "dos Estados Unidos", "SA": "da América do Sul"}


@dataclass(frozen=True, slots=True)
class _Sku:
    """Produto da AWS (`usagetype` sem o prefixo da borda), preço do catálogo e franquia."""

    usagetype: str
    family: str
    attributes: Mapping[str, str]
    description: str
    unit: str
    aws_unit: str
    free: str


# Conjunto fechado: SKU do catálogo -> produto e preço, na ordem das consultas e dos preços.
_SKUS: Mapping[str, _Sku] = {
    "cloudfront-https-requests": _Sku(
        usagetype="Requests-Tier2-HTTPS",
        family="Request",
        attributes={"requestType": "CloudFront-Request-Tier2"},
        description="Requisições HTTPS",
        unit="request",
        aws_unit="Requests",
        free="10000000",
    ),
    "cloudfront-data-transfer-out": _Sku(
        usagetype="DataTransfer-Out-Bytes",
        family="Data Transfer",
        attributes={"transferType": "CloudFront Outbound", "toLocation": "External"},
        description="Saída para a internet",
        unit="GB",
        aws_unit="GB",
        free="1024",
    ),
}


def _edge(region: str) -> str:
    """Local de borda (prefixo do `usagetype`) da região do design."""
    if region not in _EDGE:
        raise PricingError("região sem local de borda do CloudFront")
    return _EDGE[region]


def queries(region: str) -> tuple[Query, ...]:
    """Uma consulta por `usagetype` das bordas da região."""
    edge = _edge(region)
    return tuple(
        Query(_CODE, (Filter("usagetype", f"{edge}-{s.usagetype}"),)) for s in _SKUS.values()
    )


def _price(products: Sequence[Product], edge: str, sku: str) -> Price | None:
    spec = _SKUS[sku]
    wanted = {"usagetype": f"{edge}-{spec.usagetype}", **spec.attributes}
    found = [
        p
        for p in products
        if p.family == spec.family and all(p.attributes.get(k) == v for k, v in wanted.items())
    ]
    if len(found) > 1:
        raise PricingError(f"mais de um produto da AWS: {sku}")
    if not found:
        return None
    if any(d.unit != spec.aws_unit for d in found[0].dimensions):
        raise PricingError(f"unidade da AWS inesperada: {sku}")
    # Zero sai sempre "0" (`decimal_text`); faixa grátis contaria a franquia duas vezes.
    if any(d.usd == "0" for d in found[0].dimensions):
        raise PricingError(f"faixa sem preço: {sku}")
    description = f"{spec.description} (bordas {_EDGE_NAME[edge]})"
    return Price(sku, description, spec.unit, tiers(found[0].dimensions), FreeTier(spec.free))


def build(region: str, products: Sequence[Product]) -> tuple[Price, ...]:
    """Os preços das bordas da região; SKU sem produto não sai e sobra para `expected_skus`."""
    edge = _edge(region)
    prices = (_price(products, edge, sku) for sku in _SKUS)
    return tuple(price for price in prices if price is not None)


SERVICE = ServiceSpec(
    slug="cloudfront",
    service_code=_CODE,
    queries=queries,
    build=build,
    expected_skus=frozenset(_SKUS),
)
