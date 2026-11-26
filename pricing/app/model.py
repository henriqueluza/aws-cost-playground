"""Tipos compartilhados do gerador de catálogo: consulta, produto da AWS, preço e serviço.

O formato de saída segue `docs/architecture/aws-cost-playground/price-catalog.md`. Valores
decimais andam como string canônica (`decimal_text`), nunca como `float`.
"""

import re
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Literal


class PricingError(Exception):
    """Falha do gerador. A mensagem é fixa ou leva só identificador validado, nunca dado da AWS."""


FilterType = Literal["TERM_MATCH", "EQUALS", "CONTAINS", "ANY_OF", "NONE_OF"]


@dataclass(frozen=True, slots=True)
class Filter:
    """Filtro do `GetProducts`; os filtros de uma consulta se combinam por AND."""

    field: str
    value: str
    type: FilterType = "TERM_MATCH"


@dataclass(frozen=True, slots=True)
class Query:
    """Uma chamada paginada ao `GetProducts`."""

    service_code: str
    filters: tuple[Filter, ...]


@dataclass(frozen=True, slots=True)
class Dimension:
    """Faixa de preço OnDemand de um produto. Valores já em `decimal_text`; `end` None é `Inf`."""

    unit: str
    begin: str
    end: str | None
    usd: str


@dataclass(frozen=True, slots=True)
class Product:
    """Item do `PriceList` já validado. `dimensions` vem ordenado por `begin`."""

    sku: str
    family: str
    attributes: Mapping[str, str]
    dimensions: tuple[Dimension, ...]


@dataclass(frozen=True, slots=True)
class Tier:
    """Faixa do catálogo: `up_to` é o limite cumulativo; None só na última."""

    up_to: str | None
    unit_price: str


@dataclass(frozen=True, slots=True)
class FreeTier:
    """Franquia mensal; `pool` junta SKUs que dividem a mesma franquia."""

    quantity: str
    pool: str | None = None


@dataclass(frozen=True, slots=True)
class Price:
    """Preço de um SKU do catálogo (ex.: `lambda-requests`). Texto escrito por nós, não da AWS."""

    sku: str
    description: str
    unit: str
    tiers: tuple[Tier, ...]
    free_tier: FreeTier | None = None
    minimum_quantity: str | None = None


def no_queries(region: str) -> tuple[Query, ...]:
    """Serviço provisório: não consulta a AWS."""
    return ()


def no_prices(region: str, products: Sequence[Product]) -> tuple[Price, ...]:
    """Serviço provisório: não gera preço."""
    return ()


@dataclass(frozen=True, slots=True)
class ServiceSpec:
    """Um arquivo do catálogo por região: o que consultar, como montar os preços e o que exigir.

    `queries(region)` diz as chamadas ao `GetProducts`; `build(region, produtos)` recebe os
    produtos de todas elas e devolve os preços; `expected_skus` são SKUs do catálogo que não
    podem faltar no arquivo.
    """

    slug: str
    service_code: str
    queries: Callable[[str], tuple[Query, ...]] = no_queries
    build: Callable[[str, Sequence[Product]], Sequence[Price]] = no_prices
    expected_skus: frozenset[str] = frozenset()


def region_filter(region: str) -> Filter:
    """Filtro padrão de região (`regionCode`) para serviços regionais."""
    return Filter("regionCode", region)


_DECIMAL = re.compile(r"([0-9]{1,15})(?:\.([0-9]{1,40}))?")
_MAX_FRACTION_DIGITS = 12


def decimal_text(raw: object) -> str:
    """Normaliza um decimal da AWS sem arredondar (`0.0000002000` vira `0.0000002`).

    Recusa o que não for string, sinal, expoente, separador, mais de 15 dígitos inteiros ou
    mais de 12 casas significativas: o catálogo não admite arredondamento.
    """
    match = _DECIMAL.fullmatch(raw) if isinstance(raw, str) else None
    if match is None:
        raise PricingError("decimal fora do formato")
    integer = match.group(1).lstrip("0") or "0"
    fraction = (match.group(2) or "").rstrip("0")
    if len(fraction) > _MAX_FRACTION_DIGITS:
        raise PricingError("decimal com mais de 12 casas")
    return f"{integer}.{fraction}" if fraction else integer
