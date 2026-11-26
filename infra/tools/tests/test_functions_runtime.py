"""O runtime das Lambdas e o alvo do zip seguem `api/.python-version`.

O zip (`scripts/build-functions.sh`) leva wheels compiladas para uma versão do Python e uma
arquitetura. Se o módulo `functions` declarar outra, a função falha ao importar, e só no primeiro
deploy. Roda com `python3 -m unittest discover -s infra/tools/tests`.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
# Arquitetura da Lambda -> plataforma do uv com a glibc do Amazon Linux 2023 (2.34) ou anterior.
PLATFORMS = {"arm64": "aarch64-manylinux_2_28"}


def python_version() -> str:
    version = (ROOT / "api" / ".python-version").read_text(encoding="utf-8").strip()
    assert re.fullmatch(r"3\.\d+", version), f"api/.python-version inesperado: {version!r}"
    return version


def module_values(attribute: str) -> list[str]:
    text = (ROOT / "infra/modules/functions/main.tf").read_text(encoding="utf-8")
    return re.findall(rf"^\s*{attribute}\s*=\s*(.+?)\s*$", text, re.M)


class FunctionsRuntimeTest(unittest.TestCase):
    def test_module_runtime_is_the_python_of_the_package(self) -> None:
        self.assertEqual(module_values("runtime"), [f'"python{python_version()}"'])

    def test_build_targets_the_runtime_version_and_architecture(self) -> None:
        self.assertEqual(module_values("architectures"), ['["arm64"]'])
        lines = (ROOT / "scripts/build-functions.sh").read_text(encoding="utf-8").splitlines()
        script = "\n".join(line for line in lines if not line.lstrip().startswith("#"))
        self.assertIn(f"--python-platform {PLATFORMS['arm64']} ", script)
        # A versão não é escrita no script: sai do mesmo arquivo que o runtime acompanha.
        self.assertIn('--python-version "$(tr -d \'[:space:]\' < "$root/api/.python-version")"', script)
        self.assertIn("--only-binary :all:", script)


if __name__ == "__main__":
    unittest.main()
