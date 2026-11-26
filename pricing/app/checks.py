"""Checagens antes de gravar: as que bloqueiam e a variação contra o arquivo anterior."""

import json
from collections.abc import Mapping, Sequence
from decimal import Decimal

from app.model import Price, ServiceSpec
from app.schema import validate_price_file

MAX_FILE_BYTES = 500_000
MAX_VARIATION = Decimal("0.30")
NO_COMPARISON = "sem comparação: arquivo anterior ausente ou inválido"


def parse_price_file(content: bytes) -> object | None:
    """JSON de um arquivo de preço, ou None se não for JSON UTF-8 dentro do tamanho."""
    if len(content) >= MAX_FILE_BYTES:
        return None
    try:
        doc: object = json.loads(content.decode("utf-8"))
    except ValueError, RecursionError:
        return None
    return doc


def _previous(content: bytes | None) -> Mapping[str, tuple[Decimal, ...]] | None:
    """Preço unitário de cada faixa, por SKU, do arquivo anterior válido."""
    doc = None if content is None else parse_price_file(content)
    if not isinstance(doc, dict) or validate_price_file(doc):
        return None
    return {p["sku"]: tuple(Decimal(t["unitPrice"]) for t in p["tiers"]) for p in doc["prices"]}


def _current(prices: Sequence[Price]) -> Mapping[str, tuple[Decimal, ...]]:
    return {p.sku: tuple(Decimal(t.unit_price) for t in p.tiers) for p in prices}


def blocking(spec: ServiceSpec, prices: Sequence[Price], content: bytes) -> list[str]:
    """Erros que impedem a gravação do arquivo de um serviço."""
    errors: list[str] = []
    if not prices:
        errors.append("nenhum preço gerado")
    missing = sorted(spec.expected_skus - {p.sku for p in prices})
    if missing:
        errors.append(f"SKU esperado ausente: {', '.join(missing)}")
    if any(t.unit_price.startswith("-") for p in prices for t in p.tiers):
        errors.append("preço negativo")
    if len(content) >= MAX_FILE_BYTES:
        errors.append("arquivo de 500 KB ou mais")
    return errors


def regression(previous: bytes | None, prices: Sequence[Price]) -> list[str]:
    """Sinais de resposta quebrada da AWS, que bloqueiam: metade dos SKUs sumiu ou preço zerou."""
    before = _previous(previous)
    if before is None:
        return []
    after = _current(prices)
    errors: list[str] = []
    if len(after) * 2 < len(before):
        errors.append("mais da metade dos SKUs do arquivo anterior sumiu")
    for sku in sorted(before.keys() & after.keys()):
        if any(old > 0 and new == 0 for old, new in zip(before[sku], after[sku], strict=False)):
            errors.append(f"preço zerado: {sku}")
    return errors


def variation(previous: bytes | None, prices: Sequence[Price]) -> list[str]:
    """Relatório, sem bloquear: SKU novo, SKU removido e faixa com variação maior que 30%."""
    before = _previous(previous)
    if before is None:
        return [NO_COMPARISON]
    after = _current(prices)
    report = [f"SKU novo: {sku}" for sku in sorted(after.keys() - before.keys())]
    report.extend(f"SKU removido: {sku}" for sku in sorted(before.keys() - after.keys()))
    for sku in sorted(before.keys() & after.keys()):
        if len(before[sku]) != len(after[sku]):
            report.append(f"faixas mudaram: {sku}")
        for index, (old, new) in enumerate(zip(before[sku], after[sku], strict=False)):
            if old != new and (old == 0 or abs(new - old) / old > MAX_VARIATION):
                report.append(f"variação maior que 30%: {sku} faixa {index}")
    return report
