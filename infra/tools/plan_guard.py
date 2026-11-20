#!/usr/bin/env python3
"""plan-guard: reprova planos do Terraform que apagam ou substituem recursos.

Uso:  python3 infra/tools/plan_guard.py <plano.json>
      (o JSON vem de `terraform show -json <arquivo-de-plano>`)

Saída:
  0  nenhum recurso será apagado nem substituído
  1  há `delete` ou `replace`; os endereços vão para a stdout, um por linha
  2  entrada inválida (arquivo ausente, JSON inválido ou formato inesperado); falha fechada

Só a biblioteca padrão: roda no runner do CI sem instalar nada.
"""

from __future__ import annotations

import sys
from dataclasses import dataclass
from typing import Any

EXIT_OK = 0
EXIT_DESTRUCTIVE = 1
EXIT_INVALID = 2


class InvalidPlanError(ValueError):
    """O conteúdo não é um plano JSON do Terraform que o guard saiba ler."""


@dataclass(frozen=True)
class DestructiveChange:
    address: str
    actions: tuple[str, ...]

    @property
    def kind(self) -> str:
        """`replace` quando o recurso é recriado; `delete` quando só é apagado."""
        raise NotImplementedError


def find_destructive(plan: Any) -> list[DestructiveChange]:
    """Devolve, na ordem do plano, os recursos cujo `change.actions` contém `delete`.

    Levanta InvalidPlanError se `plan` não for um objeto de plano válido.
    """
    raise NotImplementedError


def main(argv: list[str] | None = None) -> int:
    """Lê o arquivo de `argv[0]`, imprime o relatório e devolve o código de saída."""
    raise NotImplementedError


if __name__ == "__main__":
    sys.exit(main())
