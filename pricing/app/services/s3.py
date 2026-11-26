"""S3 (`aws.s3`): armazenamento e requisições das classes Standard e Standard-IA.

Uma consulta por `usagetype`, com o prefixo da região (`SAE1-` em sa-east-1). O `build` só aceita
o produto que casa família, `usagetype`, `regionCode` e, no armazenamento, `volumeType`; o resto
da resposta é ignorado (ex.: `Requests-Annotation-Tier1`, de mesmo grupo e preço, e o
Intelligent-Tiering). Ficam fora a franquia de 12 meses (5 GB), a recuperação do Standard-IA e
os mínimos de 128 KB e 30 dias: o contrato do bloco não tem essas entradas.
"""

from collections.abc import Sequence
from dataclasses import dataclass

from app.model import Filter, Price, PricingError, Product, Query, ServiceSpec, region_filter
from app.products import tiers

PREFIX = {"us-east-1": "", "sa-east-1": "SAE1-"}
_SERVICE_CODE = "AmazonS3"


@dataclass(frozen=True, slots=True)
class _Kind:
    """Família na Price List, unidade da AWS e unidade do catálogo."""

    family: str
    aws_unit: str
    unit: str


_STORAGE = _Kind("Storage", "GB-Mo", "GB-month")
_REQUEST = _Kind("API Request", "Requests", "request")


@dataclass(frozen=True, slots=True)
class _Item:
    """SKU do catálogo e o produto que o define; `usagetype` sem o prefixo da região."""

    sku: str
    description: str
    kind: _Kind
    usagetype: str
    volume_type: str | None = None


_ITEMS = (
    _Item(
        "s3-storage-standard",
        "Armazenamento S3 Standard",
        _STORAGE,
        "TimedStorage-ByteHrs",
        "Standard",
    ),
    _Item(
        "s3-storage-standard-ia",
        "Armazenamento S3 Standard-IA",
        _STORAGE,
        "TimedStorage-SIA-ByteHrs",
        "Standard - Infrequent Access",
    ),
    _Item(
        "s3-requests-put-standard",
        "Requisições PUT, COPY, POST e LIST (S3 Standard)",
        _REQUEST,
        "Requests-Tier1",
    ),
    _Item(
        "s3-requests-get-standard",
        "Requisições GET e demais (S3 Standard)",
        _REQUEST,
        "Requests-Tier2",
    ),
    _Item(
        "s3-requests-put-standard-ia",
        "Requisições PUT, COPY, POST e LIST (S3 Standard-IA)",
        _REQUEST,
        "Requests-SIA-Tier1",
    ),
    _Item(
        "s3-requests-get-standard-ia",
        "Requisições GET e demais (S3 Standard-IA)",
        _REQUEST,
        "Requests-SIA-Tier2",
    ),
)


def _prefix(region: str) -> str:
    prefix = PREFIX.get(region)
    if prefix is None:
        raise PricingError("região sem prefixo de usagetype do S3")
    return prefix


def queries(region: str) -> tuple[Query, ...]:
    """Uma consulta por `usagetype`, na ordem dos itens."""
    prefix = _prefix(region)
    return tuple(
        Query(_SERVICE_CODE, (region_filter(region), Filter("usagetype", prefix + item.usagetype)))
        for item in _ITEMS
    )


def _pick(item: _Item, region: str, prefix: str, products: Sequence[Product]) -> Product | None:
    """O único produto que casa exatamente com o item; None se nenhum casar."""
    found = [
        p
        for p in products
        if p.family == item.kind.family
        and p.attributes.get("usagetype") == prefix + item.usagetype
        and p.attributes.get("regionCode") == region
        and (item.volume_type is None or p.attributes.get("volumeType") == item.volume_type)
    ]
    if len(found) > 1:
        raise PricingError(f"mais de um produto para {item.sku}")
    return found[0] if found else None


def _price(item: _Item, product: Product) -> Price:
    """Preço do item; recusa outra unidade (preço por 1.000 requisições daria custo 1.000x)."""
    if any(d.unit != item.kind.aws_unit for d in product.dimensions):
        raise PricingError(f"unidade inesperada para {item.sku}")
    return Price(item.sku, item.description, item.kind.unit, tiers(product.dimensions))


def build(region: str, products: Sequence[Product]) -> tuple[Price, ...]:
    """Preços dos itens encontrados; item sem produto fica fora e o `blocking` acusa."""
    prefix = _prefix(region)
    picked = [(item, _pick(item, region, prefix, products)) for item in _ITEMS]
    return tuple(_price(item, product) for item, product in picked if product is not None)


SERVICE = ServiceSpec(
    slug="s3",
    service_code=_SERVICE_CODE,
    queries=queries,
    build=build,
    expected_skus=frozenset(item.sku for item in _ITEMS),
)
