"""CloudFront (`aws.cloudfront`): requisições HTTPS e saída para a internet.

O preço do CloudFront depende de onde está quem acessa (o local de borda que atende), não da
região da origem, e a Price List dele é global: `region_filter` não serve. Usamos as bordas do
continente da região do design, filtradas pelo `usagetype`. A franquia permanente (1 TB de
saída e 10 milhões de requisições por mês) não vem na Price List: o `build` a acrescenta e
recusa faixa de preço zero, para não contá-la duas vezes.
"""

from collections.abc import Mapping, Sequence
from decimal import Decimal

from app.model import Filter, FreeTier, Price, PricingError, Product, Query, ServiceSpec
from app.products import tiers

_CODE = "AmazonCloudFront"
_REQUESTS = "cloudfront-https-requests"
_TRANSFER = "cloudfront-data-transfer-out"

EDGE = {"us-east-1": "US", "sa-east-1": "SA"}
_EDGE_NAME = {"US": "dos Estados Unidos", "SA": "da América do Sul"}


def _edge(region: str) -> str:
    """Local de borda (prefixo do `usagetype`) da região do design."""
    if region not in EDGE:
        raise PricingError("região sem local de borda do CloudFront")
    return EDGE[region]


def queries(region: str) -> tuple[Query, ...]:
    """Requisições HTTPS e saída para a internet das bordas da região."""
    edge = _edge(region)
    return (
        Query(_CODE, (Filter("usagetype", f"{edge}-Requests-Tier2-HTTPS"),)),
        Query(_CODE, (Filter("usagetype", f"{edge}-DataTransfer-Out-Bytes"),)),
    )


def _pick(
    sku: str, products: Sequence[Product], family: str, attributes: Mapping[str, str]
) -> Product | None:
    """O único produto da família com esses atributos, ou None; dois para o mesmo SKU é erro."""
    found = [
        p
        for p in products
        if p.family == family and all(p.attributes.get(k) == v for k, v in attributes.items())
    ]
    if len(found) > 1:
        raise PricingError(f"mais de um produto para {sku}")
    return found[0] if found else None


def _price(
    product: Product, sku: str, description: str, unit: str, aws_unit: str, free: str
) -> Price:
    """Preço do produto com a franquia permanente acrescentada."""
    if any(d.unit != aws_unit for d in product.dimensions):
        raise PricingError("unidade inesperada no CloudFront")
    if any(Decimal(d.usd) == 0 for d in product.dimensions):
        raise PricingError("faixa de preço zero no CloudFront: a franquia contaria duas vezes")
    return Price(sku, description, unit, tiers(product.dimensions), FreeTier(free))


def build(region: str, products: Sequence[Product]) -> tuple[Price, ...]:
    """Os dois preços das bordas da região; produto ausente fica fora e o `blocking` recusa."""
    edge = _edge(region)
    name = _EDGE_NAME[edge]
    prices: list[Price] = []
    requests = _pick(
        _REQUESTS,
        products,
        "Request",
        {"usagetype": f"{edge}-Requests-Tier2-HTTPS", "requestType": "CloudFront-Request-Tier2"},
    )
    if requests is not None:
        description = f"Requisições HTTPS (bordas {name})"
        prices.append(_price(requests, _REQUESTS, description, "request", "Requests", "10000000"))
    transfer = _pick(
        _TRANSFER,
        products,
        "Data Transfer",
        {
            "usagetype": f"{edge}-DataTransfer-Out-Bytes",
            "transferType": "CloudFront Outbound",
            "toLocation": "External",
        },
    )
    if transfer is not None:
        description = f"Saída para a internet (bordas {name})"
        prices.append(_price(transfer, _TRANSFER, description, "GB", "GB", "1024"))
    return tuple(prices)


SERVICE = ServiceSpec(
    slug="cloudfront",
    service_code=_CODE,
    queries=queries,
    build=build,
    expected_skus=frozenset({_REQUESTS, _TRANSFER}),
)
