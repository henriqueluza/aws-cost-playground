"""Corpo do PR semanal de preços, a partir do relatório de `python -m app` (#29).

Uso no workflow: `python -m app.summary < report.txt > body.md`.
Nenhuma linha do relatório entra crua no corpo: só o que casa o formato conhecido, com SKU
validado por `is_sku`; o resto vira contagem.
"""

import sys
from collections.abc import Sequence
from typing import TextIO


def pr_body(report: Sequence[str]) -> str:
    """Markdown com as seções `## SKUs adicionados`, `## SKUs removidos`,
    `## Variações acima de 30%` e `## Outros`, nesta ordem, e o rodapé fixo.

    Determinístico; termina com `\\n`. Seção vazia mostra `Nenhum.`; mais de 200 itens numa
    seção viram `e mais N`.
    """
    raise NotImplementedError


def main(stdin: TextIO | None = None, stdout: TextIO | None = None) -> int:
    """Lê o relatório (uma linha por item) e escreve o corpo do PR. Exit 0."""
    raise NotImplementedError


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
