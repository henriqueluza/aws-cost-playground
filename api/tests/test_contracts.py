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


def _attrs(count: int) -> list[Json]:
    return [{"key": f"k{i}", "options": ["a"]} for i in range(count)]


def _usages(blocks: Json, count: int) -> list[Json]:
    return [{**_usage(blocks, "avgDurationMs"), "key": f"k{i}"} for i in range(count)]


def _pairs(edges: Json, count: int) -> list[Json]:
    return edges["kinds"][0]["pairs"][:1] * count


def _at_limits(blocks: Json, edges: Json) -> None:
    """32 atributos, 32 chaves de uso, 32 pares e textos de 40 caracteres: o teto de cada regra."""
    usage = _usages(blocks, 32)
    usage[0]["unit"] = "u" * 40
    _lambda(blocks).update(attributes=_attrs(32), usage=usage, name="a" * 40)
    edges["kinds"][0].update(pairs=_pairs(edges, 32), usage=usage)


def test_aceita_contrato_nos_limites(tmp_path: Path) -> None:
    contracts = load_contracts(_write(tmp_path, _at_limits))
    block = contracts.blocks["aws.lambda"]
    assert (len(block.attributes), len(block.usage), len(block.name)) == (32, 32, 40)
    assert len(contracts.edges[RAW_EDGES["kinds"][0]["kind"]].pairs) == 32


INVALID: dict[str, Mutation] = {
    "33 atributos": lambda b, e: _lambda(b).update(attributes=_attrs(33)),
    "33 chaves de uso no bloco": lambda b, e: _lambda(b).update(usage=_usages(b, 33)),
    "33 chaves de uso na aresta": lambda b, e: e["kinds"][0].update(usage=_usages(b, 33)),
    "33 pares": lambda b, e: e["kinds"][0].update(pairs=_pairs(e, 33)),
    "33 opções": lambda b, e: _arch(b).update(options=[f"o{i}" for i in range(33)]),
    "nome de 41 caracteres": lambda b, e: _lambda(b).update(name="a" * 41),
    "opção de 65 caracteres": lambda b, e: _arch(b)["options"].append("a" * 65),
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
    "opção 10**400": lambda b, e: _lambda(b)["attributes"][1]["options"].append(10**400),
    "client fora de data": lambda b, e: e["kinds"][1]["pairs"][0]["targets"].append("client"),
    "kind faltando": lambda b, e: e["kinds"].pop(),
    "kind repetido": lambda b, e: e["kinds"].append(e["kinds"][0]),
    "schemaVersion booleano": lambda b, e: b.update(schemaVersion=True),
    "unidade de 41 caracteres": lambda b, e: _usage(b, "avgDurationMs").update(unit="a" * 41),
    "kind sem pares": lambda b, e: e["kinds"][0].update(pairs=[]),
}


@pytest.mark.parametrize("mutate", INVALID.values(), ids=list(INVALID))
def test_recusa_contrato_quebrado(tmp_path: Path, mutate: Mutation) -> None:
    with pytest.raises(ValidationError):
        load_contracts(_write(tmp_path, mutate))


def test_lista_de_opcoes_vazia_e_recusada_so_pela_regra_do_tamanho(tmp_path: Path) -> None:
    """Sem `default` e sem outra regra quebrada: o único erro é o `min_length` de `options`."""

    def empty(blocks: Json, edges: Json) -> None:
        _arch(blocks).pop("default")
        _arch(blocks).update(options=[])

    with pytest.raises(ValidationError) as caught:
        load_contracts(_write(tmp_path, empty))
    assert [(e["type"], e["loc"][-1]) for e in caught.value.errors()] == [("too_short", "options")]


def _cut(path: Path) -> None:
    path.write_text("{")


@pytest.mark.parametrize(
    ("name", "damage", "error"),
    [
        ("blocks.json", Path.unlink, RuntimeError),
        ("edges.json", Path.unlink, FileNotFoundError),
        ("blocks.json", _cut, ValidationError),
        ("edges.json", _cut, ValidationError),
    ],
    ids=["sem-blocks", "sem-edges", "blocks-cortado", "edges-cortado"],
)
def test_arquivo_ausente_ou_cortado_falha_fechado(
    tmp_path: Path, name: str, damage: Callable[[Path], object], error: type[Exception]
) -> None:
    damage(_write(tmp_path, lambda b, e: None) / name)
    with pytest.raises(error):
        load_contracts(tmp_path)


def test_get_contracts_le_uma_vez_e_reutiliza() -> None:
    get_contracts.cache_clear()
    first = get_contracts()
    assert get_contracts() is first
    assert get_contracts.cache_info().hits == 1
    assert first == load_contracts(REPO)
    get_contracts.cache_clear()
