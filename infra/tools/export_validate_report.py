#!/usr/bin/env python3
"""Confere o relatório JSON do vitest do job export-validate (#68).

Uso: export_validate_report.py <relatorio.json> <contracts/scenarios>

O teste `web/src/features/export/test/terraform.local.test.ts` se pula sozinho sem as
variáveis `EXPORT_TERRAFORM_*`, e teste pulado termina verde. Este script fecha a brecha:
exige um teste aprovado por arquivo de cenário e nenhum teste pulado ou reprovado.

Saída 0: tudo validado. Saída 1: falta cenário, ou há teste pulado ou reprovado.
Saída 2: relatório ou diretório ilegível (falha fechada).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

TITLE = "o export do cenário {name} passa no validate com o provider da AWS"


def scenario_name(path: Path) -> str:
    """`api-serverless.json` -> `apiServerless`, o nome que o teste dá ao cenário."""
    head, *rest = path.stem.split("-")
    return head + "".join(part[:1].upper() + part[1:] for part in rest)


def check(report: object, names: list[str]) -> list[str]:
    if not isinstance(report, dict) or not isinstance(report.get("testResults"), list):
        raise TypeError("relatório sem `testResults`")
    # Lista, não dicionário: um título repetido não pode esconder um teste reprovado.
    results = [
        (str(test.get("title")), str(test.get("status")))
        for suite in report["testResults"]
        for test in suite.get("assertionResults", [])
    ]
    passed = {title for title, status in results if status == "passed"}
    errors = []
    if not names:
        errors.append("nenhum cenário em contracts/scenarios")
    if report.get("success") is not True:
        errors.append("o vitest não terminou com sucesso")
    for title, status in sorted(results):
        if status != "passed":
            errors.append(f"teste {status}: {title}")
    for name in names:
        if TITLE.format(name=name) not in passed:
            errors.append(f"cenário sem teste de validate: {name}")
    return errors


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(__doc__, file=sys.stderr)
        return 2
    try:
        report = json.loads(Path(argv[1]).read_text(encoding="utf-8"))
        names = sorted(scenario_name(p) for p in Path(argv[2]).iterdir() if p.suffix == ".json")
        errors = check(report, names)
    except (OSError, ValueError, TypeError) as error:
        print(f"::error::export-validate: relatório ilegível ({type(error).__name__})")
        return 2
    for error in errors:
        print(f"::error::export-validate: {error}")
    if errors:
        return 1
    print(f"export-validate: {len(names)} cenários validados: {', '.join(names)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
