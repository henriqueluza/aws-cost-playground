"""ElastiCache (`aws.elasticache`): nós sob demanda (on-demand), cobrados por nó-hora, dos motores
Redis OSS e Memcached.

Fora: ElastiCache Serverless, motor Valkey, nós reservados, backup e snapshot, data tiering,
Global Datastore, Extended Support, Outposts e a franquia de 12 meses (o projeto não a modela).
Mensagens de erro levam só o SKU do catálogo, nunca texto da AWS.
"""

from collections.abc import Mapping, Sequence
from typing import NamedTuple

from app.model import Filter, Price, PricingError, Product, Query, ServiceSpec, region_filter
from app.products import tiers

_CODE = "AmazonElastiCache"
_AWS_UNIT = "Hrs"
# Prefixo do `usagetype` por região; as chaves são as de `catalog.REGIONS`. O `usagetype`
# completo separa o NodeUsage do ExtendedSupport e do Outposts, que cobram o mesmo nó.
_PREFIXES: Mapping[str, str] = {"us-east-1": "", "sa-east-1": "SAE1-"}


class _Engine(NamedTuple):
    operation: str
    label: str


# Motor do SKU -> operation da AWS e nome na descrição. Filtra por `operation`, e não por
# `cacheEngine`: o código de operação é a chave de cobrança e não mudou com o rebrand "Redis OSS".
_ENGINES: Mapping[str, _Engine] = {
    "redis": _Engine("CreateCacheCluster:0002", "Redis OSS"),
    "memcached": _Engine("CreateCacheCluster:0001", "Memcached"),
}
_NODE_TYPES = (
    "cache.t3.micro",
    "cache.t3.small",
    "cache.t3.medium",
    "cache.t4g.micro",
    "cache.t4g.small",
    "cache.t4g.medium",
    "cache.m5.large",
    "cache.r5.large",
)
# Conjunto fechado, na ordem das consultas: SKU do catálogo -> (motor, tipo de nó).
_SKUS: Mapping[str, tuple[str, str]] = {
    f"elasticache-{engine}-{node}": (engine, node) for engine in _ENGINES for node in _NODE_TYPES
}


def _filters(region: str, sku: str) -> tuple[Filter, ...]:
    """Filtros do SKU na região: tipo de nó pelo `usagetype` e motor pela `operation`."""
    prefix = _PREFIXES.get(region)
    if prefix is None:
        raise PricingError("região sem prefixo de usagetype")
    engine, node = _SKUS[sku]
    return (
        region_filter(region),
        Filter("usagetype", f"{prefix}NodeUsage:{node}"),
        Filter("operation", _ENGINES[engine].operation),
    )


def queries(region: str) -> tuple[Query, ...]:
    """Uma consulta por SKU na região."""
    return tuple(Query(_CODE, _filters(region, sku)) for sku in _SKUS)


def _select(products: Sequence[Product], filters: Sequence[Filter]) -> list[Product]:
    """Produtos com todos os atributos dos filtros: o TERM_MATCH refeito sobre a resposta."""
    return [p for p in products if all(p.attributes.get(f.field) == f.value for f in filters)]


def _price(products: Sequence[Product], region: str, sku: str) -> Price | None:
    found = _select(products, _filters(region, sku))
    if len(found) > 1:
        raise PricingError(f"mais de um produto da AWS: {sku}")
    if not found:
        return None
    if any(d.unit != _AWS_UNIT for d in found[0].dimensions):
        raise PricingError(f"unidade da AWS inesperada: {sku}")
    price_tiers = tiers(found[0].dimensions)
    # Zero sai sempre "0" (`decimal_text`); faixa grátis aqui seria franquia não declarada.
    if price_tiers[0].unit_price == "0":
        raise PricingError(f"primeira faixa sem preço: {sku}")
    engine, node = _SKUS[sku]
    return Price(sku, f"Nó {node} ({_ENGINES[engine].label})", "node-hour", price_tiers)


def build(region: str, products: Sequence[Product]) -> tuple[Price, ...]:
    """Um preço por SKU com produto na região; SKU sem produto não sai."""
    prices = (_price(products, region, sku) for sku in _SKUS)
    return tuple(price for price in prices if price is not None)


SERVICE = ServiceSpec(
    slug="elasticache",
    service_code=_CODE,
    queries=queries,
    build=build,
    expected_skus=frozenset(_SKUS),
)
