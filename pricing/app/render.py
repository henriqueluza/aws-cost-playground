"""Serialização determinística dos arquivos do catálogo e hash."""

import hashlib
import json
from collections.abc import Sequence

from app.model import Price

_SCHEMA_VERSION = 1


def _price_doc(price: Price) -> dict[str, object]:
    """Preço na ordem de chaves do formato; opcional ausente é omitido, nunca `null`."""
    doc: dict[str, object] = {
        "sku": price.sku,
        "description": price.description,
        "unit": price.unit,
        "tiers": [{"upTo": t.up_to, "unitPrice": t.unit_price} for t in price.tiers],
    }
    if price.free_tier is not None:
        free: dict[str, str] = {"quantity": price.free_tier.quantity}
        if price.free_tier.pool is not None:
            free["pool"] = price.free_tier.pool
        doc["freeTier"] = free
    if price.minimum_quantity is not None:
        doc["minimumQuantity"] = price.minimum_quantity
    return doc


def render_price_file(service: str, region: str, prices: Sequence[Price]) -> bytes:
    """JSON do arquivo `<region>/<service>.json`; mesma entrada, mesmos bytes."""
    doc = {
        "schemaVersion": _SCHEMA_VERSION,
        "service": service,
        "region": region,
        "currency": "USD",
        "prices": [_price_doc(p) for p in sorted(prices, key=lambda p: p.sku)],
    }
    return (json.dumps(doc, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def sha256_hex(content: bytes) -> str:
    """sha256 em 64 caracteres hexadecimais minúsculos."""
    return hashlib.sha256(content).hexdigest()
