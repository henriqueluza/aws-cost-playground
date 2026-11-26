"""DynamoDB (`aws.dynamodb`), classe Standard: leituras e escritas sob demanda, capacidade
provisionada por hora e armazenamento.

Fora: classe Standard-IA, tabelas globais (escritas replicadas), PITR e backups, streams, export
e import, capacidade reservada e busca vetorial.

Franquia embutida: diferente da Lambda, que lê um produto global, aqui a AWS põe a franquia como
1ª faixa grátis do próprio produto regional (não há produto global). Ela vira `freeTier` e só a
faixa paga entra em `tiers`. Mensagens de erro levam só o SKU do catálogo, nunca texto da AWS.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from app.model import (
    Dimension,
    Filter,
    FreeTier,
    Price,
    PricingError,
    Product,
    Query,
    ServiceSpec,
    Tier,
    region_filter,
)
from app.products import tiers

_CODE = "AmazonDynamoDB"


@dataclass(frozen=True, slots=True)
class _Sku:
    """Atributos que filtram a consulta e selecionam o produto, unidades e franquia embutida."""

    attributes: Mapping[str, str]
    aws_unit: str
    unit: str
    description: str
    embedded_free: bool


# Conjunto fechado, na ordem das consultas; os atributos seguem a ordem dos filtros.
_SKUS: Mapping[str, _Sku] = {
    "dynamodb-read-requests": _Sku(
        {"group": "DDB-ReadUnits", "operation": "PayPerRequestThroughput"},
        "ReadRequestUnits",
        "read request unit",
        "Leituras sob demanda",
        embedded_free=False,
    ),
    "dynamodb-write-requests": _Sku(
        {"group": "DDB-WriteUnits", "operation": "PayPerRequestThroughput"},
        "WriteRequestUnits",
        "write request unit",
        "Escritas sob demanda",
        embedded_free=False,
    ),
    "dynamodb-read-capacity": _Sku(
        {"group": "DDB-ReadUnits", "operation": "CommittedThroughput"},
        "ReadCapacityUnit-Hrs",
        "RCU-hour",
        "Capacidade de leitura provisionada",
        embedded_free=True,
    ),
    "dynamodb-write-capacity": _Sku(
        {"group": "DDB-WriteUnits", "operation": "CommittedThroughput"},
        "WriteCapacityUnit-Hrs",
        "WCU-hour",
        "Capacidade de escrita provisionada",
        embedded_free=True,
    ),
    "dynamodb-storage": _Sku(
        {"volumeType": "Amazon DynamoDB - Indexed DataStore"},
        "GB-Mo",
        "GB-month",
        "Armazenamento (Standard)",
        embedded_free=True,
    ),
}


def queries(region: str) -> tuple[Query, ...]:
    """Uma consulta por SKU na região, com os atributos que separam o produto."""
    return tuple(
        Query(_CODE, (region_filter(region), *(Filter(k, v) for k, v in s.attributes.items())))
        for s in _SKUS.values()
    )


def _select(products: Sequence[Product], region: str, **attributes: str) -> list[Product]:
    """Produtos da região com todos os atributos iguais (o TERM_MATCH, de novo, sobre a resposta)."""
    return [
        p
        for p in products
        if p.attributes.get("regionCode", "") == region
        and all(p.attributes.get(k) == v for k, v in attributes.items())
    ]


def _embedded(sku: str, dimensions: Sequence[Dimension]) -> tuple[FreeTier, tuple[Tier, ...]]:
    """1ª faixa grátis de 0 até F (a franquia) e 2ª paga de F sem fim; outro formato é erro."""
    message = f"franquia ausente ou fora do formato: {sku}"
    if len(dimensions) != 2:
        raise PricingError(message)
    free, paid = dimensions
    # `decimal_text` já normalizou zero para "0".
    if (free.begin, free.usd) != ("0", "0") or free.end is None:
        raise PricingError(message)
    if paid.begin != free.end or paid.end is not None or paid.usd == "0":
        raise PricingError(message)
    return FreeTier(quantity=free.end), (Tier(None, paid.usd),)


def _price(products: Sequence[Product], region: str, sku: str) -> Price | None:
    spec = _SKUS[sku]
    found = _select(products, region, **spec.attributes)
    if len(found) > 1:
        raise PricingError(f"mais de um produto da AWS: {sku}")
    if not found:
        return None
    if any(d.unit != spec.aws_unit for d in found[0].dimensions):
        raise PricingError(f"unidade da AWS inesperada: {sku}")
    if spec.embedded_free:
        free, price_tiers = _embedded(sku, found[0].dimensions)
        return Price(sku, spec.description, spec.unit, price_tiers, free)
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
    slug="dynamodb",
    service_code=_CODE,
    queries=queries,
    build=build,
    expected_skus=frozenset(_SKUS),
)
