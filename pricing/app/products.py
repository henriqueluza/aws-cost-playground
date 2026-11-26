"""Leitura defensiva dos itens do `PriceList` (formato `aws_v1`) e conversão em faixas."""

import json
import re
from collections.abc import Mapping, Sequence
from decimal import Decimal
from types import MappingProxyType

from app.model import Dimension, PricingError, Product, Tier, decimal_text

_MAX_RAW = 200_000
_MAX_FAMILY = 128
_MAX_UNIT = 64
_MAX_TIERS = 16
_SKU = re.compile(r"[A-Za-z0-9]{1,64}")
_FORMAT = "item do PriceList fora do formato"


def _obj(value: object) -> Mapping[str, object]:
    """Exige objeto JSON."""
    if not isinstance(value, dict):
        raise PricingError(_FORMAT)
    return value


def _text(value: object, max_len: int, min_len: int = 1) -> str:
    """Exige string com tamanho entre `min_len` e `max_len`."""
    if not isinstance(value, str) or not min_len <= len(value) <= max_len:
        raise PricingError(_FORMAT)
    return value


def _num(text: str) -> Decimal:
    """Decimal de um texto no formato `decimal_text` (revalida o formato)."""
    return Decimal(decimal_text(text))


def _attributes(value: object) -> Mapping[str, str]:
    """Atributos do produto: só valores string, em mapeamento imutável."""
    attributes: dict[str, str] = {}
    for key, item in _obj(value).items():
        if not isinstance(item, str):
            raise PricingError("atributo do produto fora do formato")
        attributes[key] = item
    return MappingProxyType(attributes)


def _dimension(value: object) -> Dimension:
    """Uma `priceDimension` do termo OnDemand; ignora descrição, rateCode e appliesTo."""
    data = _obj(value)
    unit = _text(data.get("unit"), _MAX_UNIT)
    begin = decimal_text(data.get("beginRange"))
    end_raw = data.get("endRange")
    end = None if end_raw == "Inf" else decimal_text(end_raw)
    usd = decimal_text(_obj(data.get("pricePerUnit")).get("USD"))
    if end is not None and _num(end) <= _num(begin):
        raise PricingError("faixa de preço com fim antes do início")
    return Dimension(unit, begin, end, usd)


def _dimensions(terms: object) -> tuple[Dimension, ...]:
    """Dimensões do único termo OnDemand, ordenadas por início; outros termos são ignorados."""
    on_demand = _obj(_obj(terms).get("OnDemand", {}))
    if len(on_demand) > 1:
        raise PricingError("mais de um termo OnDemand no produto")
    found = [
        _dimension(item)
        for term in on_demand.values()
        for item in _obj(_obj(term).get("priceDimensions")).values()
    ]
    return tuple(sorted(found, key=lambda x: _num(x.begin)))


def parse_product(raw: object) -> Product:
    """Valida um item do `PriceList` (string JSON, entrada não confiável)."""
    if not isinstance(raw, str) or len(raw) > _MAX_RAW:
        raise PricingError(_FORMAT)
    try:
        parsed = json.loads(raw)
    except ValueError, RecursionError:
        raise PricingError("item do PriceList não é JSON válido") from None
    data = _obj(parsed)
    product = _obj(data.get("product"))
    sku = product.get("sku")
    if not isinstance(sku, str) or _SKU.fullmatch(sku) is None:
        raise PricingError("SKU do PriceList fora do formato")
    try:
        family = _text(product.get("productFamily", ""), _MAX_FAMILY, min_len=0)
        attributes = _attributes(product.get("attributes", {}))
        dimensions = _dimensions(data.get("terms", {}))
    except PricingError as exc:
        # As mensagens internas são fixas; o SKU já foi validado acima.
        raise PricingError(f"{exc} (SKU {sku})") from None
    return Product(sku, family, attributes, dimensions)


def tiers(dimensions: Sequence[Dimension]) -> tuple[Tier, ...]:
    """Converte dimensões contíguas a partir de 0 em faixas do catálogo; a última é aberta."""
    if not 1 <= len(dimensions) <= _MAX_TIERS:
        raise PricingError("quantidade de faixas fora do limite")
    if len({x.unit for x in dimensions}) != 1:
        raise PricingError("faixas com unidades diferentes")
    ordered = sorted(dimensions, key=lambda x: _num(x.begin))
    expected = Decimal(0)
    for index, current in enumerate(ordered):
        is_last = index == len(ordered) - 1
        end = None if current.end is None else _num(current.end)
        begin = _num(current.begin)
        if begin != expected or (end is None) != is_last or (end is not None and end <= begin):
            raise PricingError("faixas sem continuidade a partir de zero")
        if end is not None:
            expected = end
    return tuple(Tier(up_to=x.end, unit_price=x.usd) for x in ordered)
