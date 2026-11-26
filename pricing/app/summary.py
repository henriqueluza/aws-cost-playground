"""Corpo do PR semanal de preços, a partir do relatório de `python -m app` (#29).

Uso no workflow: `python -m app.summary < report.txt > body.md`.
Nenhuma linha do relatório entra crua no corpo: só o que casa o formato conhecido, com SKU
validado por `is_sku` e arquivo validado por `file_key`; o resto vira contagem.
"""

import re
import sys
from collections import Counter
from collections.abc import Sequence
from typing import TextIO

from app.catalog import file_key
from app.schema import is_sku

MAX_ITEMS = 100

_LINE = re.compile(r"(?P<region>[a-z0-9-]+)/(?P<slug>[a-z0-9-]+)\.json: (?P<msg>.+)")
_ADDED = re.compile(r"SKU novo: (?P<sku>\S+)")
_REMOVED = re.compile(r"SKU removido: (?P<sku>\S+)")
_VARIATION = re.compile(r"variação maior que 30%: (?P<sku>\S+) faixa (?P<tier>[0-9]{1,2})")
_TIERS_CHANGED = re.compile(r"faixas mudaram: (?P<sku>\S+)")
_BAD_SKU = "SKU novo fora do formato"
_NO_BASELINE = "sem comparação: arquivo anterior ausente ou inválido"
_PROVISIONAL = re.compile(r"serviço provisório: (?P<slug>[a-z][a-z0-9-]{0,39})")
_NOTHING = "nenhum serviço com consulta: nada a gravar"

_INTRO = (
    "Atualização semanal do catálogo de preços em `web/public/prices/`, gerada da Price List API."
)
_FOOTER = (
    "O merge é humano. Este PR é aberto pelo `GITHUB_TOKEN`, que não dispara os workflows de "
    "`pull_request`: feche e reabra o PR para rodar o CI."
)
_OUTSIDE = "linhas fora do padrão"
_NOTHING_KEY = "nothing"
_PROVISIONAL_KEY = "provisional"
_TIERS_KEY = "tiers"
_BAD_SKU_KEY = "bad_sku"
_NO_BASELINE_KEY = "no_baseline"


def _file(region: str, slug: str) -> str | None:
    try:
        return file_key(region, slug)
    except ValueError:
        return None


def _section(title: str, items: list[str]) -> list[str]:
    lines = ["", f"## {title}", ""]
    if not items:
        return [*lines, "Nenhum."]
    lines.extend(items[:MAX_ITEMS])
    if len(items) > MAX_ITEMS:
        lines.append(f"- e mais {len(items) - MAX_ITEMS}")
    return lines


def pr_body(report: Sequence[str]) -> str:
    """Markdown com as seções `## SKUs adicionados`, `## SKUs removidos`,
    `## Variações acima de 30%` e `## Outros`, nesta ordem, e o rodapé fixo.

    Determinístico; termina com `\\n`. Seção vazia mostra `Nenhum.`; mais de 100 itens numa
    seção viram `e mais N`.
    """
    added: list[str] = []
    removed: list[str] = []
    varied: list[str] = []
    counts: Counter[str] = Counter()
    for raw in report:
        line = raw.rstrip("\r\n")
        if not line.strip():
            continue
        if line == _NOTHING:
            counts[_NOTHING_KEY] += 1
        elif _PROVISIONAL.fullmatch(line) is not None:
            counts[_PROVISIONAL_KEY] += 1
        elif (m := _LINE.fullmatch(line)) is None or (
            path := _file(m["region"], m["slug"])
        ) is None:
            counts[_OUTSIDE] += 1
        elif (hit := _ADDED.fullmatch(m["msg"])) and is_sku(hit["sku"]):
            added.append(f"- `{path}`: `{hit['sku']}`")
        elif (hit := _REMOVED.fullmatch(m["msg"])) and is_sku(hit["sku"]):
            removed.append(f"- `{path}`: `{hit['sku']}`")
        elif (hit := _VARIATION.fullmatch(m["msg"])) and is_sku(hit["sku"]):
            varied.append(f"- `{path}`: `{hit['sku']}` faixa {hit['tier']}")
        elif (hit := _TIERS_CHANGED.fullmatch(m["msg"])) and is_sku(hit["sku"]):
            counts[_TIERS_KEY] += 1
        elif m["msg"] == _BAD_SKU:
            counts[_BAD_SKU_KEY] += 1
        elif m["msg"] == _NO_BASELINE:
            counts[_NO_BASELINE_KEY] += 1
        else:
            counts[_OUTSIDE] += 1

    others = []
    if counts[_NOTHING_KEY]:
        others.append("Nenhum serviço com consulta: nada foi gravado.")
    for key, label in (
        (_TIERS_KEY, "faixas mudaram"),
        (_NO_BASELINE_KEY, "sem comparação"),
        (_PROVISIONAL_KEY, "serviço provisório"),
        (_BAD_SKU_KEY, "SKU novo fora do formato"),
        (_OUTSIDE, _OUTSIDE),
    ):
        if counts[key]:
            others.append(f"- {label}: {counts[key]}")

    lines = [_INTRO]
    lines += _section("SKUs adicionados", added)
    lines += _section("SKUs removidos", removed)
    lines += _section("Variações acima de 30%", varied)
    lines += _section("Outros", others)
    lines += ["", _FOOTER]
    return "\n".join(lines) + "\n"


def main(stdin: TextIO | None = None, stdout: TextIO | None = None) -> int:
    """Lê o relatório (uma linha por item) e escreve o corpo do PR. Exit 0."""
    source = stdin if stdin is not None else sys.stdin
    target = stdout if stdout is not None else sys.stdout
    target.write(pr_body(source.read().split("\n")))
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
