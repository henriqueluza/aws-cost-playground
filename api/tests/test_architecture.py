import shutil
import subprocess
import sys
from pathlib import Path

import pytest

API_ROOT = Path(__file__).resolve().parent.parent
LINT_IMPORTS = Path(sys.executable).parent / "lint-imports"
CONTRACT = "Routers não acessam AWS nem a Claude API diretamente"


def _lint(tmp_path: Path, router_source: str) -> subprocess.CompletedProcess[str]:
    shutil.copytree(
        API_ROOT / "app", tmp_path / "app", ignore=shutil.ignore_patterns("__pycache__")
    )
    shutil.copy(API_ROOT / "pyproject.toml", tmp_path / "pyproject.toml")
    (tmp_path / "app" / "designs" / "router.py").write_text(router_source)
    # Lista fixa de argumentos, executável do próprio venv e sem entrada externa.
    return subprocess.run(  # noqa: S603
        [str(LINT_IMPORTS)],
        cwd=tmp_path,
        env={"PYTHONPATH": str(tmp_path), "PATH": str(LINT_IMPORTS.parent)},
        capture_output=True,
        text=True,
        check=False,
    )


@pytest.mark.parametrize("source", ["import boto3\n", "import anthropic\n"])
def test_router_importando_sdk_diretamente_quebra_o_contrato(tmp_path: Path, source: str) -> None:
    result = _lint(tmp_path, source)
    assert result.returncode != 0
    assert CONTRACT in result.stdout + result.stderr


def test_router_importando_boto3_indiretamente_e_permitido(tmp_path: Path) -> None:
    result = _lint(tmp_path, "from app import dynamo\n")
    assert result.returncode == 0, result.stdout + result.stderr
