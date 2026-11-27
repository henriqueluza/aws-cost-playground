#!/usr/bin/env python3
"""plan-guard: reprova planos do Terraform que apagam, substituem, esquecem ou importam recursos.

Uso:  python3 infra/tools/plan_guard.py <plano.json>
      (o JSON vem de `terraform show -json <arquivo-de-plano>`)

Saída:
  0  nenhum recurso será apagado, substituído, esquecido nem importado; stdout:
     `plan-guard: nenhuma ação destrutiva`
  1  há `delete`, `replace`, `forget` ou `import` (recurso com `change.importing`, de um
     bloco `import`); uma linha por recurso na stdout, no formato
     `<kind>\t<address>\t<ação1,ação2>` (só endereço e ações, nunca valores do plano)
  2  entrada inválida (sem argumento, arquivo ilegível, JSON inválido, formato inesperado
     ou plano com `errored: true`); mensagem na stderr, stdout vazia. Falha fechada.

`resource_changes` ausente é um plano válido sem mudanças.

Só a biblioteca padrão: roda no runner do CI sem instalar nada.
"""

from __future__ import annotations

import json
import sys
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

EXIT_OK = 0
EXIT_DESTRUCTIVE = 1
EXIT_INVALID = 2

# `forget` (bloco `removed` com `destroy = false`) tira o recurso do estado: é um `state rm`.
BLOCKING_ACTIONS: frozenset[str] = frozenset({"delete", "forget"})
# Ação fora desta lista (nova ou grafada diferente) é entrada inválida, não plano seguro.
KNOWN_ACTIONS: frozenset[str] = BLOCKING_ACTIONS | {"no-op", "create", "read", "update"}


class InvalidPlanError(ValueError):
    """O conteúdo não é um plano JSON do Terraform que o guard saiba ler."""


@dataclass(frozen=True)
class DestructiveChange:
    address: str
    actions: tuple[str, ...]
    importing: bool = False

    @property
    def kind(self) -> str:
        """`replace` se as ações têm `delete` e `create`; senão `delete`, `forget` ou `import`."""
        if "delete" in self.actions:
            return "replace" if "create" in self.actions else "delete"
        return "forget" if "forget" in self.actions else "import"


def find_destructive(plan: Mapping[str, Any]) -> list[DestructiveChange]:
    """Devolve, na ordem do plano, os recursos com ação em BLOCKING_ACTIONS ou em importação.

    Importação é `change.importing` com um objeto (`{"id": ...}` no Terraform 1.16), qualquer
    que seja a ação: importar sem mudar nada sai como `no-op`. Ausente ou `null` não é importação.

    Levanta InvalidPlanError (falha fechada) se a raiz não é objeto, falta `format_version`,
    `errored` é `true` (plano parcial: as mudanças listadas não são o plano inteiro) ou não é
    booleano, `resource_changes` existe e não é lista, ou um item não tem `address` (str),
    `change.actions` (lista de ações de KNOWN_ACTIONS) ou tem `change.importing` que não é objeto.
    """
    if not isinstance(plan, Mapping) or "format_version" not in plan:
        raise InvalidPlanError("não é um plano do Terraform (falta `format_version`)")
    errored = plan.get("errored", False)
    if not isinstance(errored, bool):
        raise InvalidPlanError("`errored` não é booleano")
    if errored:
        raise InvalidPlanError("o plano terminou com erro (`errored: true`)")
    changes = plan.get("resource_changes", [])
    if not isinstance(changes, list):
        raise InvalidPlanError("`resource_changes` não é uma lista")
    found: list[DestructiveChange] = []
    for index, item in enumerate(changes):
        address = item.get("address") if isinstance(item, Mapping) else None
        change = item.get("change") if isinstance(item, Mapping) else None
        actions = change.get("actions") if isinstance(change, Mapping) else None
        if (
            not isinstance(address, str)
            or not isinstance(actions, list)
            or not all(isinstance(action, str) and action in KNOWN_ACTIONS for action in actions)
        ):
            raise InvalidPlanError(f"`resource_changes[{index}]`: `address` ou `actions` inválido")
        importing = change.get("importing")
        if importing is not None and not isinstance(importing, Mapping):
            raise InvalidPlanError(f"`resource_changes[{index}]`: `importing` inválido")
        if BLOCKING_ACTIONS.intersection(actions) or importing is not None:
            found.append(DestructiveChange(address, tuple(actions), importing is not None))
    return found


def _one_line(text: str) -> str:
    """Escapa caracteres de controle: chave de `for_each` não pode forjar linhas do relatório."""
    return "".join(char if char.isprintable() else f"\\x{ord(char):02x}" for char in text)


def main(argv: Sequence[str] | None = None) -> int:
    """Lê o arquivo de `argv[0]` (padrão: sys.argv[1:]), imprime o relatório e devolve o código."""
    args = sys.argv[1:] if argv is None else list(argv)
    if len(args) != 1:
        print("uso: plan_guard.py <plano.json>", file=sys.stderr)
        return EXIT_INVALID
    try:
        with open(args[0], encoding="utf-8") as handle:
            destructive = find_destructive(json.load(handle))
    except (OSError, ValueError, RecursionError) as error:
        # Só o tipo do erro e a mensagem do guard: nunca o conteúdo do plano.
        detail = str(error) if isinstance(error, InvalidPlanError) else type(error).__name__
        print(f"plan-guard: entrada inválida ({detail})", file=sys.stderr)
        return EXIT_INVALID
    if not destructive:
        print("plan-guard: nenhuma ação destrutiva")
        return EXIT_OK
    for change in destructive:
        actions = ",".join(change.actions)
        print(f"{change.kind}\t{_one_line(change.address)}\t{_one_line(actions)}")
    return EXIT_DESTRUCTIVE


if __name__ == "__main__":
    sys.exit(main())
