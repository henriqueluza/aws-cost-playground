"""`contracts/`: a API lê os mesmos arquivos do `web/`, sem segunda cópia das faixas de uso."""

import copy
import json
from collections.abc import Callable
from pathlib import Path
from typing import Any, get_args

import pytest
from pydantic import ValidationError

from app import contracts as module
from app.contracts import PRD_BLOCK_LEVELS, BlockType, Contracts, get_contracts, load_contracts

REPO = Path(__file__).resolve().parents[2] / "contracts"
RAW_BLOCKS = json.loads((REPO / "blocks.json").read_text())
RAW_EDGES = json.loads((REPO / "edges.json").read_text())
Json = dict[str, Any]
Mutation = Callable[[Json, Json], object]


def _lambda(blocks: Json) -> Json:
    return next(b for b in blocks["blocks"] if b["type"] == "aws.lambda")


def _usage(blocks: Json, key: str) -> Json:
    return next(u for u in _lambda(blocks)["usage"] if u["key"] == key)


def _duration(contracts: Contracts) -> Json:
    usage = contracts.blocks["aws.lambda"].usage
    return next(u.model_dump() for u in usage if u.key == "avgDurationMs")


def _write(directory: Path, mutate: Mutation) -> Path:
    blocks, edges = copy.deepcopy(RAW_BLOCKS), copy.deepcopy(RAW_EDGES)
    mutate(blocks, edges)
    directory.mkdir(exist_ok=True)
    (directory / "blocks.json").write_text(json.dumps(blocks))
    (directory / "edges.json").write_text(json.dumps(edges))
    return directory


def test_le_os_arquivos_reais_com_os_valores_do_json() -> None:
    contracts = load_contracts(REPO)
    assert len(contracts.blocks) == 20
    assert set(contracts.blocks) == set(PRD_BLOCK_LEVELS) == set(get_args(BlockType))
    assert set(contracts.edges) == {"data", "runs-on", "logs"}
    assert _duration(contracts) == _usage(RAW_BLOCKS, "avgDurationMs")
    memory = contracts.blocks["aws.lambda"].attributes[1]
    assert memory.key == "memoryMb"
    assert memory.model_dump() == _lambda(RAW_BLOCKS)["attributes"][1]
    read = {t: b.model_dump(by_alias=True, exclude_none=True) for t, b in contracts.blocks.items()}
    assert read == {b["type"]: b for b in RAW_BLOCKS["blocks"]}
    edges = {k: e.model_dump(by_alias=True) for k, e in contracts.edges.items()}
    assert edges == {e["kind"]: e for e in RAW_EDGES["kinds"]}


def test_sem_diretorio_usa_a_faixa_do_primeiro_candidato_com_arquivo(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    narrow = {"min": 5, "default": 6, "max": 7}
    changed = _write(tmp_path / "repo", lambda b, e: _usage(b, "avgDurationMs").update(narrow))
    monkeypatch.setattr(module, "_SEARCH_DIRS", (tmp_path / "task", changed))
    assert _duration(load_contracts()).items() >= narrow.items()


def _arch(blocks: Json) -> Json:
    return _lambda(blocks)["attributes"][0]


INVALID: dict[str, Mutation] = {
    "padrão fora da faixa": lambda b, e: _usage(b, "avgDurationMs").update(default=900001),
    "faixa vazia": lambda b, e: _usage(b, "avgDurationMs").update(min=120, max=120),
    "integer com fração": lambda b, e: _usage(b, "requestsPerMonth").update(default=1.5),
    "bool como número": lambda b, e: _usage(b, "avgDurationMs").update(default=True),
    "chave repetida": lambda b, e: _lambda(b)["usage"].append(_usage(b, "avgDurationMs")),
    "nível diferente do PRD": lambda b, e: _lambda(b).update(level="B"),
    "categoria desconhecida": lambda b, e: _lambda(b).update(category="ml"),
    "tipo repetido": lambda b, e: b.update(blocks=[*b["blocks"][:-1], _lambda(b)]),
    "padrão de atributo fora das opções": lambda b, e: _arch(b).update(default="ppc"),
    "padrão de atributo null": lambda b, e: _arch(b).update(default=None),
    "opção repetida": lambda b, e: _arch(b)["options"].append("arm64"),
    "opções de tipos diferentes": lambda b, e: _arch(b)["options"].append(1),
    "client fora de data": lambda b, e: e["kinds"][1]["pairs"][0]["targets"].append("client"),
    "kind faltando": lambda b, e: e["kinds"].pop(),
    "kind repetido": lambda b, e: e["kinds"].append(e["kinds"][0]),
    "schemaVersion booleano": lambda b, e: b.update(schemaVersion=True),
}


@pytest.mark.parametrize("mutate", INVALID.values(), ids=list(INVALID))
def test_recusa_contrato_quebrado(tmp_path: Path, mutate: Mutation) -> None:
    with pytest.raises(ValidationError):
        load_contracts(_write(tmp_path, mutate))


@pytest.mark.parametrize("damage", [Path.unlink, lambda p: p.write_text("{")])
@pytest.mark.parametrize("name", ["blocks.json", "edges.json"])
def test_arquivo_ausente_ou_cortado_falha_fechado(tmp_path: Path, name: str, damage: Any) -> None:
    damage(_write(tmp_path, lambda b, e: None) / name)
    with pytest.raises((RuntimeError, OSError, ValidationError)):
        load_contracts(tmp_path)


def test_get_contracts_le_uma_vez_e_reutiliza() -> None:
    get_contracts.cache_clear()
    first = get_contracts()
    assert get_contracts() is first
    assert get_contracts.cache_info().hits == 1
    assert first == load_contracts(REPO)
    get_contracts.cache_clear()
