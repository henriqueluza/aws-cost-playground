"""Revalidação da saída da LLM, tratada como entrada hostil (ADR-0001, T2). Função pura.

Nada do que a LLM devolve é copiado: o resultado é montado do zero, só com os ids do diagrama, as
chaves de uso do contrato e números dentro da faixa. O resto é descartado.
"""

import math
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal

from app.contracts import UsageKeyDefinition

Number = int | float


@dataclass(frozen=True)
class Slot:
    """Bloco ou aresta do diagrama, na posição `n` da lista, com as chaves que o contrato aceita."""

    id: str
    keys: tuple[UsageKeyDefinition, ...]


@dataclass(frozen=True)
class ItemUsage:
    """`source` é `default` quando nenhum valor válido veio da LLM para o item."""

    id: str
    values: dict[str, Number]
    source: Literal["llm", "default"]


def _number(value: object, key: UsageKeyDefinition) -> Number | None:
    """Número finito, limitado à faixa do contrato e inteiro quando a chave pede; senão `None`."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if isinstance(value, float) and not math.isfinite(value):
        return None
    # Comparar int com float em Python é exato: um inteiro de centenas de dígitos não estoura.
    clamped = min(max(value, key.min), key.max)
    if key.integer:
        return round(clamped)
    return int(clamped) if float(clamped).is_integer() else clamped


def _answers(raw: object, size: int) -> dict[int, dict[str, object]]:
    """Agrupa por `n` os pares `{key, value}`. Item fora do formato ou do diagrama é descartado."""
    if not isinstance(raw, list):
        raise ValueError("Saída fora do schema.")
    answers: dict[int, dict[str, object]] = {}
    for item in raw:
        if not isinstance(item, dict):
            continue
        n, pairs = item.get("n"), item.get("values")
        if isinstance(n, bool) or not isinstance(n, int) or not 0 <= n < size:
            continue
        if not isinstance(pairs, list):
            continue
        target = answers.setdefault(n, {})
        for pair in pairs:
            if isinstance(pair, dict) and isinstance(pair.get("key"), str):
                target.setdefault(pair["key"], pair.get("value"))  # repetição: vale a primeira
    return answers


def _apply(raw: object, slots: Sequence[Slot]) -> tuple[ItemUsage, ...]:
    answers = _answers(raw, len(slots))
    items: list[ItemUsage] = []
    for n, slot in enumerate(slots):
        answer = answers.get(n, {})
        values: dict[str, Number] = {}
        from_llm = False
        for key in slot.keys:
            number = _number(answer.get(key.key), key)
            from_llm = from_llm or number is not None
            values[key.key] = key.default if number is None else number
        items.append(ItemUsage(slot.id, values, "llm" if from_llm else "default"))
    return tuple(items)


def revalidate(
    raw: object, blocks: Sequence[Slot], edges: Sequence[Slot]
) -> tuple[tuple[ItemUsage, ...], tuple[ItemUsage, ...]]:
    """Um `ItemUsage` por bloco e por aresta do diagrama, na ordem de entrada.

    Chave ausente ou inválida recebe o padrão do contrato. `ValueError` se `raw` não for
    `{"blocks": [...], "edges": [...]}`: nesse caso nada da resposta é usado.
    """
    if not isinstance(raw, dict):
        raise ValueError("Saída fora do schema.")
    return _apply(raw.get("blocks"), blocks), _apply(raw.get("edges"), edges)
