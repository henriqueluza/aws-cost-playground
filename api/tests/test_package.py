"""Zip das Lambdas (`scripts/build-functions.sh`): leva os contratos que a API lê em execução.

O script roda de verdade em bash, com um `uv` falso no PATH no lugar do índice de pacotes: sem
rede e sem AWS. O `uv` falso instala uma dependência de mentira com o lixo que o script remove.
"""

import json
import os
import shutil
import subprocess
import sys
import zipfile
from hashlib import sha256
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
SCRIPT = REPO / "scripts" / "build-functions.sh"
CONTRACT_FILES = ("contracts/blocks.json", "contracts/edges.json")
FAKE_UV = """#!/bin/sh
previous=""
for argument in "$@"; do
  case "$previous" in
    --output-file) : > "$argument" ;;
    --target)
      mkdir -p "$argument/fakedep/__pycache__" "$argument/bin"
      echo "VALUE = 1" > "$argument/fakedep/__init__.py"
      : > "$argument/fakedep/__pycache__/__init__.pyc"
      : > "$argument/bin/tool"
      ;;
  esac
  previous="$argument"
done
"""
PROBE = """
import json
from app import contracts
loaded = contracts.get_contracts()
print(json.dumps({"module": contracts.__file__, "blocks": len(loaded.blocks),
                  "edges": sorted(loaded.edges),
                  "found": [str(d) for d in contracts._SEARCH_DIRS if d.is_dir()]}))
"""


def _build(tmp_path: Path, name: str) -> tuple[Path, str]:
    """Roda o script e devolve o zip e o sha256 que ele imprimiu."""
    fake_bin = tmp_path / "bin"
    fake_bin.mkdir(exist_ok=True)
    fake_uv = fake_bin / "uv"
    fake_uv.write_text(FAKE_UV, encoding="utf-8")
    fake_uv.chmod(0o755)
    out = tmp_path / name
    env = {**os.environ, "PATH": f"{fake_bin}{os.pathsep}{os.environ['PATH']}"}
    bash = shutil.which("bash")
    assert bash is not None
    proc = subprocess.run(  # noqa: S603
        [bash, str(SCRIPT), str(out)],
        capture_output=True, text=True, timeout=120, check=False, env=env, cwd=tmp_path,
    )  # fmt: skip
    assert proc.returncode == 0, proc.stderr
    return out, proc.stdout.strip()


@pytest.fixture(scope="module")
def package(tmp_path_factory: pytest.TempPathFactory) -> Path:
    return _build(tmp_path_factory.mktemp("package"), "functions.zip")[0]


def test_zip_carries_only_the_two_contract_files(package: Path) -> None:
    with zipfile.ZipFile(package) as archive:
        names = archive.namelist()
        assert sorted(n for n in names if n.startswith("contracts")) == list(CONTRACT_FILES)
        for name in CONTRACT_FILES:
            assert archive.read(name) == (REPO / name).read_bytes()
    assert {n.split("/")[0] for n in names} == {"app", "contracts", "fakedep"}
    assert "app/contracts.py" in names


def test_zip_has_no_tests_caches_or_env_files(package: Path) -> None:
    with zipfile.ZipFile(package) as archive:
        names = archive.namelist()
    for name in names:
        parts = name.split("/")
        assert not {"tests", "__pycache__", "bin", "examples", "scenarios"} & set(parts), name
        assert not parts[-1].endswith(".pyc"), name
        assert not parts[-1].startswith(".env"), name


def test_zip_is_deterministic(package: Path, tmp_path: Path) -> None:
    again, printed = _build(tmp_path, "again.zip")
    assert again.read_bytes() == package.read_bytes()
    assert printed == sha256(again.read_bytes()).hexdigest()


def test_extracted_package_loads_the_contracts(package: Path, tmp_path: Path) -> None:
    root = tmp_path / "task"
    with zipfile.ZipFile(package) as archive:
        archive.extractall(root)
    # Só o pacote extraído no caminho: `app` não pode vir de `api/` nem os JSON da raiz do
    # repositório (`tmp_path/contracts`, o segundo lugar de busca, não existe).
    env = {k: v for k, v in os.environ.items() if k != "PYTHONPATH"}
    proc = subprocess.run(  # noqa: S603
        [sys.executable, "-c", PROBE],
        capture_output=True, text=True, timeout=60, check=False, env=env, cwd=root,
    )  # fmt: skip
    assert proc.returncode == 0, proc.stderr
    result = json.loads(proc.stdout)
    assert Path(result["module"]).resolve() == (root / "app" / "contracts.py").resolve()
    assert [Path(found).resolve() for found in result["found"]] == [(root / "contracts").resolve()]
    assert result["blocks"] == 20
    assert result["edges"] == ["data", "logs", "runs-on"]
