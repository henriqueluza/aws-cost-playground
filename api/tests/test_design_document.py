import copy
import json
from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError

from app.design_document import DesignDocument, doc_size_bytes

EXAMPLES = Path(__file__).resolve().parents[2] / "contracts" / "examples" / "design"
ADR: dict[str, Any] = json.loads((EXAMPLES / "valid" / "adr-example.json").read_text("utf-8"))
AVG = '"avgDurationMs": 120'


def doc(**changes: Any) -> dict[str, Any]:
    return {**copy.deepcopy(ADR), **changes}


def block(**changes: Any) -> dict[str, Any]:
    d = doc()
    d["blocks"][0].update(changes)
    return d


def accepts(raw: str) -> bool:
    """Valida nos dois caminhos: `json.loads` + `validate_python` (FastAPI) e `validate_json`."""
    try:
        DesignDocument.model_validate(json.loads(raw))
        DesignDocument.model_validate_json(raw)
    except ValidationError:
        return False
    return True


def ok(d: dict[str, Any]) -> bool:
    return accepts(json.dumps(d))


def files(kind: str) -> list[Path]:
    return sorted((EXAMPLES / kind).glob("*.json"))


def js_size(d: dict[str, Any]) -> int:
    return len(json.dumps(d, separators=(",", ":"), ensure_ascii=False).encode())


@pytest.mark.parametrize("kind", ["valid", "invalid"])
def test_diretorio_de_exemplos_nao_esta_vazio(kind: str) -> None:
    assert files(kind)


@pytest.mark.parametrize("path", files("valid"), ids=lambda p: p.name)
def test_exemplo_valido_passa_nos_dois_modos(path: Path) -> None:
    assert accepts(path.read_text("utf-8"))


@pytest.mark.parametrize("path", files("invalid"), ids=lambda p: p.name)
def test_exemplo_invalido_e_recusado_nos_dois_modos(path: Path) -> None:
    raw = path.read_text("utf-8")
    with pytest.raises(ValidationError):
        DesignDocument.model_validate(json.loads(raw))
    with pytest.raises(ValidationError):
        DesignDocument.model_validate_json(raw)


def blocks(n: int) -> dict[str, Any]:
    return doc(edges=[], blocks=[{**ADR["blocks"][1], "id": f"blk_{i}"} for i in range(n)])


def edges(n: int) -> dict[str, Any]:
    return doc(edges=[{**ADR["edges"][0], "id": f"edg_{i}"} for i in range(n)])


@pytest.mark.parametrize(
    ("build", "limit"),
    [
        (blocks, 100),
        (edges, 400),
        (lambda n: doc(workload={"description": "a" * n}), 2000),
        (lambda n: block(label="a" * n), 80),
        (lambda n: block(attributes={"name": "a" * n}), 64),
        # O zod 4 conta pontos de código: um emoji vale 1.
        (lambda n: doc(workload={"description": "😀" * n}), 2000),
        (lambda n: block(label="😀" * n), 80),
    ],
    ids=["blocos", "arestas", "descricao", "rotulo", "atributo", "descricao-emoji", "rotulo-emoji"],
)
def test_limites_aceitam_o_maximo_e_recusam_um_a_mais(build: Any, limit: int) -> None:
    assert ok(build(limit))
    assert not ok(build(limit + 1))


def test_chave_desconhecida_e_descartada() -> None:
    d = doc(extra=1)
    for part in (d["blocks"][0], d["edges"][0], d["blocks"][0]["usage"]):
        part["extra"] = 1
    assert DesignDocument.model_validate(d).model_dump(by_alias=True, exclude_none=True) == ADR


def test_proto_em_usage_values_e_descartado() -> None:
    raw = json.dumps(ADR).replace(AVG, '"__proto__": 1, ' + AVG)
    for parsed in (
        DesignDocument.model_validate(json.loads(raw)),
        DesignDocument.model_validate_json(raw),
    ):
        assert "__proto__" not in parsed.blocks[0].usage.values


def test_saida_em_camel_case_repete_a_entrada() -> None:
    out = DesignDocument.model_validate(ADR).model_dump(by_alias=True, exclude_none=True)
    assert out == ADR
    assert "estimatedAt" not in out["blocks"][1]["usage"]


@pytest.mark.parametrize(
    "raw",
    [
        json.dumps(ADR).replace("API handler", "\\ud800"),
        *(
            json.dumps(ADR).replace(old, f"{key}: {tok}")
            for tok in ("NaN", "Infinity", "-Infinity")
            for old, key in ((AVG, '"avgDurationMs"'), ('"memoryMb": 512', '"memoryMb"'))
        ),
    ],
    ids=["substituto", *(f"{t}-{c}" for t in ("nan", "inf", "-inf") for c in ("uso", "atributo"))],
)
def test_substituto_solto_e_nao_finito_sao_recusados(raw: str) -> None:
    assert not accepts(raw)


@pytest.mark.parametrize(
    "bad",
    [
        doc(schemaVersion=True),
        doc(schemaVersion=2),
        block(usage={"source": "llm", "estimatedAt": None, "values": {}}),
        block(usage={"source": "llm", "values": {"requestsPerMonth": 10**400}}),
    ],
    ids=["schema-bool", "schema-2", "estimated-at-null", "inteiro-enorme"],
)
def test_entrada_invalida_e_recusada(bad: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        DesignDocument.model_validate(bad)
    assert not ok(bad)


def test_doc_size_bytes_igual_ao_do_web() -> None:
    for d in (ADR, doc(workload={"description": "ação ☃ 😀 日本語"})):
        assert doc_size_bytes(DesignDocument.model_validate(d)) == js_size(d)


@pytest.mark.parametrize("literal", ["1e12", "120.0"])
def test_float_integral_conta_como_inteiro(literal: str) -> None:
    raw = json.dumps(ADR).replace(AVG, f'"avgDurationMs": {literal}')
    esperado = json.loads(raw)
    esperado["blocks"][0]["usage"]["values"]["avgDurationMs"] = int(float(literal))
    parsed = DesignDocument.model_validate(json.loads(raw))
    assert doc_size_bytes(parsed) == js_size(esperado)
