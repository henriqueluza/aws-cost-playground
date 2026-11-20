#!/usr/bin/env python3
"""plan-guard: reprova planos do Terraform que apagam ou substituem recursos.

Uso:  python3 infra/tools/plan_guard.py <plano.json>
      (o JSON vem de `terraform show -json <arquivo-de-plano>`)

Saída:
  0  nenhum recurso será apagado, substituído nem esquecido; stdout:
     `plan-guard: nenhuma ação destrutiva`
  1  há `delete`, `replace` ou `forget`; uma linha por recurso na stdout, no formato
     `<kind>\t<address>\t<ação1,ação2>` (só endereço e ações, nunca valores do plano)
  2  entrada inválida (sem argumento, arquivo ilegível, JSON inválido ou formato
     inesperado); mensagem na stderr, stdout vazia. Falha fechada.

`resource_changes` ausente é um plano válido sem mudanças.

Só a biblioteca padrão: roda no runner do CI sem instalar nada.
"""

from __future__ import annotations

import sys
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

EXIT_OK = 0
EXIT_DESTRUCTIVE = 1
EXIT_INVALID = 2

# `forget` (bloco `removed` com `destroy = false`) tira o recurso do estado: é um `state rm`.
BLOCKING_ACTIONS: frozenset[str] = frozenset({"delete", "forget"})


class InvalidPlanError(ValueError):
    """O conteúdo não é um plano JSON do Terraform que o guard saiba ler."""


@dataclass(frozen=True)
class DestructiveChange:
    address: str
    actions: tuple[str, ...]

    @property
    def kind(self) -> str:
        """`replace` se as ações têm `delete` e `create`; senão `delete` ou `forget`."""
        raise NotImplementedError


def find_destructive(plan: Mapping[str, Any]) -> list[DestructiveChange]:
    """Devolve, na ordem do plano, os recursos com alguma ação em BLOCKING_ACTIONS.

    Levanta InvalidPlanError (falha fechada) se a raiz não é objeto, falta `format_version`,
    `resource_changes` existe e não é lista, ou um item não tem `address` (str) ou
    `change.actions` (lista de str).
    """
    raise NotImplementedError


def main(argv: Sequence[str] | None = None) -> int:
    """Lê o arquivo de `argv[0]` (padrão: sys.argv[1:]), imprime o relatório e devolve o código."""
    raise NotImplementedError


if __name__ == "__main__":
    sys.exit(main())
