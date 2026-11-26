"""Espelho em Python do zod de `web/src/features/pricing/model/catalog.ts`, igual ou mais estrito.

Cada erro é "caminho: mensagem fixa"; o valor recusado nunca entra na mensagem. Chave
desconhecida é tolerada, como no zod.
"""

import re
from datetime import datetime
from decimal import Decimal

from app.catalog import REGIONS

MAX_PRICES = 200
MAX_TIERS = 16
MAX_FILES = 100
MAX_DESCRIPTION = 200
MAX_UNIT = 40

_DECIMAL = re.compile(r"[0-9]{1,15}(?:\.[0-9]{1,12})?")
_SLUG = re.compile(r"[a-z][a-z0-9-]{0,39}")
_SKU = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,63}")
_SHA256 = re.compile(r"[0-9a-f]{64}")
_PATH = re.compile(rf"(?:{'|'.join(sorted(REGIONS))})/[a-z][a-z0-9-]{{0,39}}\.json")
_DATETIME = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,9})?Z")


def _matches(pattern: re.Pattern[str], value: object) -> bool:
    return isinstance(value, str) and pattern.fullmatch(value) is not None


def _text(value: object, min_len: int, max_len: int) -> bool:
    """Tamanho em unidades UTF-16, como o `.max()` do zod."""
    if not isinstance(value, str):
        return False
    return min_len <= len(value.encode("utf-16-le", "surrogatepass")) // 2 <= max_len


def _is_one(value: object) -> bool:
    return type(value) is int and value == 1


def _datetime(value: object) -> bool:
    if not _matches(_DATETIME, value):
        return False
    try:
        datetime.strptime(str(value)[:19], "%Y-%m-%dT%H:%M:%S")
    except ValueError:
        return False
    return True


def _tier_errors(tiers: object, at: str) -> list[str]:
    if not isinstance(tiers, list) or not 1 <= len(tiers) <= MAX_TIERS:
        return [f"{at}: de 1 a {MAX_TIERS} faixas"]
    errors: list[str] = []
    previous = Decimal(0)
    for index, tier in enumerate(tiers):
        here = f"{at}[{index}]"
        if not isinstance(tier, dict):
            errors.append(f"{here}: não é objeto")
            continue
        if not _matches(_DECIMAL, tier.get("unitPrice")):
            errors.append(f"{here}.unitPrice: decimal fora do formato")
        up_to = tier.get("upTo")
        is_last = index == len(tiers) - 1
        if up_to is None:
            if not is_last:
                errors.append(f"{here}.upTo: só a última faixa é aberta")
        elif not _matches(_DECIMAL, up_to):
            errors.append(f"{here}.upTo: decimal fora do formato")
        else:
            if is_last:
                errors.append(f"{here}.upTo: a última faixa é aberta")
            if Decimal(up_to) <= previous:
                errors.append(f"{here}.upTo: faixas fora de ordem crescente")
            previous = Decimal(up_to)
    return errors


def _price_errors(price: object, at: str) -> list[str]:
    if not isinstance(price, dict):
        return [f"{at}: não é objeto"]
    errors: list[str] = []
    if not _matches(_SKU, price.get("sku")):
        errors.append(f"{at}.sku: fora do formato")
    if not _text(price.get("description"), 0, MAX_DESCRIPTION):
        errors.append(f"{at}.description: texto fora do limite")
    if not _text(price.get("unit"), 1, MAX_UNIT):
        errors.append(f"{at}.unit: texto fora do limite")
    errors.extend(_tier_errors(price.get("tiers"), f"{at}.tiers"))
    if "freeTier" in price:
        free = price["freeTier"]
        if not isinstance(free, dict):
            errors.append(f"{at}.freeTier: não é objeto")
        else:
            if not _matches(_DECIMAL, free.get("quantity")):
                errors.append(f"{at}.freeTier.quantity: decimal fora do formato")
            if "pool" in free and not _matches(_SLUG, free["pool"]):
                errors.append(f"{at}.freeTier.pool: fora do formato")
    if "minimumQuantity" in price and not _matches(_DECIMAL, price["minimumQuantity"]):
        errors.append(f"{at}.minimumQuantity: decimal fora do formato")
    return errors


def validate_price_file(doc: object) -> list[str]:
    """Erros do arquivo de preço; `[]` é válido."""
    if not isinstance(doc, dict):
        return ["arquivo: não é objeto"]
    errors: list[str] = []
    if not _is_one(doc.get("schemaVersion")):
        errors.append("schemaVersion: deve ser 1")
    if not _matches(_SLUG, doc.get("service")):
        errors.append("service: fora do formato")
    region = doc.get("region")
    if not isinstance(region, str) or region not in REGIONS:
        errors.append("region: fora da lista")
    if doc.get("currency") != "USD":
        errors.append("currency: deve ser USD")
    prices = doc.get("prices")
    if not isinstance(prices, list) or len(prices) > MAX_PRICES:
        return [*errors, f"prices: lista de até {MAX_PRICES} preços"]
    seen: set[object] = set()
    for index, price in enumerate(prices):
        errors.extend(_price_errors(price, f"prices[{index}]"))
        sku = price.get("sku") if isinstance(price, dict) else None
        if isinstance(sku, str):
            if sku in seen:
                errors.append(f"prices[{index}].sku: SKU repetido")
            seen.add(sku)
    return errors


def validate_manifest(doc: object) -> list[str]:
    """Erros do `manifest.json`; `[]` é válido."""
    if not isinstance(doc, dict):
        return ["manifest: não é objeto"]
    errors: list[str] = []
    if not _is_one(doc.get("schemaVersion")):
        errors.append("schemaVersion: deve ser 1")
    source = doc.get("source")
    if not isinstance(source, str) or source not in ("seed", "price-list"):
        errors.append("source: fora da lista")
    if not _datetime(doc.get("generatedAt")):
        errors.append("generatedAt: data fora do formato")
    files = doc.get("files")
    if not isinstance(files, list) or len(files) > MAX_FILES:
        return [*errors, f"files: lista de até {MAX_FILES} arquivos"]
    seen: set[str] = set()
    for index, entry in enumerate(files):
        here = f"files[{index}]"
        if not isinstance(entry, dict):
            errors.append(f"{here}: não é objeto")
            continue
        path = entry.get("path")
        if not _matches(_PATH, path):
            errors.append(f"{here}.path: fora do formato")
        elif path in seen:
            errors.append(f"{here}.path: arquivo repetido")
        else:
            seen.add(str(path))
        if not _matches(_SHA256, entry.get("sha256")):
            errors.append(f"{here}.sha256: fora do formato")
    return errors
