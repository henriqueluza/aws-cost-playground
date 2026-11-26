import json
from typing import Any

import pytest
from fastapi import FastAPI

from app.design_document import DesignDocument
from app.designs.schemas import MAX_DOC_BYTES, doc_size_bytes
from app.logs import configure_logging
from app.routing import MAX_BODY_BYTES
from tests.conftest import invoke, make_event
from tests.test_design_document import ADR, AVG, doc, js_size

SUB = "8f14e45f-ceea-467f-a0e6-1a2b3c4d5e6f"
DID = "01JD0000000000000000000000"


def make_doc(description: str = "") -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "region": "us-east-1",
        "workload": {"description": description},
        "blocks": [],
        "edges": [],
        "scenarios": [],
    }


def doc_of_size(target: int) -> dict[str, Any]:
    """Doc válido (100 blocos, atributos string de 64 caracteres) com exatos `target` bytes."""
    usage = {"source": "default", "values": {}}
    blocks: list[dict[str, Any]] = [
        {"id": f"blk_{i}", "type": "aws.s3", "label": "b", "usage": usage, "overrides": {}}
        | {"attributes": {}}
        for i in range(100)
    ]
    sized = make_doc() | {"blocks": blocks}
    slots = [(b["attributes"], f"a{k}") for k in range(32) for b in blocks]

    def size(count: int) -> int:
        for i, (attrs, key) in enumerate(slots):
            attrs.pop(key, None)
            if i < count:
                attrs[key] = "é" * 64
        return js_size(sized)

    low, high = 0, len(slots)  # busca binária: maior nº de atributos cheios que cabe no alvo
    while low < high:
        mid = (low + high + 1) // 2
        low, high = (mid, high) if size(mid) <= target else (low, mid - 1)
    sized["workload"] = {"description": "a" * (target - size(low))}  # o resto, 1 byte por letra
    return sized


def valid_estimate() -> dict[str, Any]:
    return {"region": "us-east-1", "description": "", "blocks": [], "edges": []}


def event(method: str, path: str, body: Any = None, *, auth: bool = True, raw: str | None = None):
    """Evento com corpo JSON (`raw` sobrepõe, para JSON malformado)."""
    headers = {"content-type": "application/json"} if body is not None or raw else {}
    payload = raw if raw is not None else (None if body is None else json.dumps(body))
    claims = {"sub": SUB} if auth else None
    return make_event(path, method=method, claims=claims, headers=headers, body=payload)


# (método, path, corpo válido, corpo malformado-mas-JSON, status de sucesso declarado)
ROUTES = [
    ("GET", "/designs", None, None, 200),
    ("POST", "/designs", {"name": "n", "doc": make_doc()}, {}, 201),
    ("GET", f"/designs/{DID}", None, None, 200),
    ("PATCH", f"/designs/{DID}", {"expectedVersion": 1, "name": "n"}, {}, 200),
    ("DELETE", f"/designs/{DID}", None, None, 204),
    ("POST", f"/designs/{DID}/duplicate", {"name": "n"}, {}, 201),
    ("POST", "/estimates", valid_estimate(), {}, 200),
    ("GET", "/quota", None, None, 200),
    ("DELETE", "/me", None, None, 204),
]
IDS = [f"{m} {p}" for m, p, *_ in ROUTES]
PROBLEM = "application/problem+json"
NOT_IMPLEMENTED = {"type": "about:blank", "title": "Not Implemented", "status": 501}


def test_conjunto_exato_de_rotas_e_status_de_sucesso(app: FastAPI) -> None:
    """Método, caminho e status do mapa do cliente (`web/src/shared/lib/http/httpApi.ts`)."""
    declared = {
        (method, route.path): route.status_code or 200
        for included in app.routes  # o FastAPI recente embrulha cada router incluído
        for route in included.original_router.routes  # type: ignore[attr-defined]
        for method in route.methods
    }
    assert declared == {(m, p.replace(DID, "{design_id}")): ok for m, p, _, _, ok in ROUTES}


@pytest.mark.parametrize(("method", "path", "valid", "invalid", "_ok"), ROUTES, ids=IDS)
def test_ordem_401_422_501(app, method, path, valid, invalid, _ok) -> None:  # type: ignore[no-untyped-def]
    """Sem identidade é 401 com qualquer corpo; com identidade, 422 antes do 501."""
    forged = {"x-user-id": SUB, "authorization": "Bearer x"}
    for body, raw in (
        (valid, None),
        (invalid, None),
        (None, "{"),
        (None, json.dumps({"sub": SUB})),
    ):
        anonymous = event(method, path, body, auth=False, raw=raw)
        anonymous["headers"] |= forged
        anonymous["rawQueryString"] = f"sub={SUB}"
        status, headers, problem = invoke(app, anonymous)
        assert (status, problem["title"]) == (401, "Unauthorized")
        assert headers["www-authenticate"] == "Bearer"
        assert headers["content-type"] == PROBLEM
    if invalid is not None:
        for raw in (json.dumps(invalid), "{"):
            status, headers, problem = invoke(app, event(method, path, raw=raw))
            assert (status, headers["content-type"]) == (422, PROBLEM)
            assert all(set(error) == {"loc", "msg"} for error in problem["errors"])
    status, headers, problem = invoke(app, event(method, path, valid))
    assert (status, headers["content-type"]) == (501, PROBLEM)
    assert problem == {**NOT_IMPLEMENTED, "requestId": "req-test-1"}  # sem `detail` interno


def test_design_id_invalido_sem_identidade_responde_401(app: FastAPI) -> None:
    assert invoke(app, event("GET", "/designs/nao-e-ulid", auth=False))[0] == 401


def test_log_da_rota_nao_traz_dado_do_usuario(
    app: FastAPI, capsys: pytest.CaptureFixture[str]
) -> None:
    configure_logging("INFO")
    invoke(app, event("PATCH", f"/designs/{DID}", {"expectedVersion": 1, "name": "segredo"}))
    out = capsys.readouterr().out
    assert '"route": "/designs/{design_id}"' in out
    assert '"status": 501' in out
    assert not any(leak in out for leak in (DID, SUB, "segredo"))


@pytest.mark.parametrize("bad_id", [DID.lower(), DID[:-1], DID + "0", "01JD000000000000000000000U"])
@pytest.mark.parametrize(
    ("method", "suffix", "body"),
    [
        ("GET", "", None),
        ("DELETE", "", None),
        ("PATCH", "", {"expectedVersion": 1, "name": "n"}),
        ("POST", "/duplicate", {"name": "n"}),
    ],
)
def test_design_id_fora_do_formato_ulid_responde_422(app, bad_id, method, suffix, body) -> None:  # type: ignore[no-untyped-def]
    status, _, problem = invoke(app, event(method, f"/designs/{bad_id}{suffix}", body))
    assert status == 422
    assert problem["errors"]


LONG_DESC = "d" * 2001
BLOCK = {"id": "blk_1", "type": "aws.s3", "attributes": {}}


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("PATCH", f"/designs/{DID}", {"expectedVersion": 1}),
        ("PATCH", f"/designs/{DID}", {"expectedVersion": 1, "name": None, "doc": make_doc()}),
        ("PATCH", f"/designs/{DID}", {"expectedVersion": 1, "name": "n", "doc": None}),
        ("PATCH", f"/designs/{DID}", {"expectedVersion": 0, "name": "n"}),
        ("PATCH", f"/designs/{DID}", {"expected_version": 1, "name": "n"}),
        ("POST", "/designs", {"name": "n", "doc": make_doc(LONG_DESC)}),
        ("POST", "/designs", {"name": "", "doc": make_doc()}),
        ("POST", "/designs", {"name": "   ", "doc": make_doc()}),
        ("POST", "/designs", {"name": "x" * 81, "doc": make_doc()}),
        ("POST", f"/designs/{DID}/duplicate", {"name": "  "}),
        ("POST", "/estimates", valid_estimate() | {"description": LONG_DESC}),
        ("POST", "/estimates", valid_estimate() | {"blocks": [BLOCK] * 101}),
    ],
    ids=[
        "patch-vazio",
        "patch-nome-null",
        "patch-doc-null",
        "patch-versao-0",
        "patch-snake-case",
        "desc-2001",
        "nome-vazio",
        "nome-espacos",
        "nome-81",
        "dup-espacos",
        "estimate-desc-2001",
        "estimate-101-blocos",
    ],
)
def test_entrada_invalida_responde_422(app, method, path, body) -> None:  # type: ignore[no-untyped-def]
    status, _, problem = invoke(app, event(method, path, body))
    assert status == 422
    assert problem["errors"]
    assert LONG_DESC[:41] not in json.dumps(problem)  # não ecoa o valor recebido


def test_design_com_101_blocos_responde_422(app: FastAPI) -> None:
    usage = {"source": "default", "values": {}}
    block = {
        "id": "blk_1",
        "type": "aws.s3",
        "label": "b",
        "attributes": {},
        "usage": usage,
        "overrides": {},
    }
    doc = make_doc() | {"blocks": [block] * 101}
    assert invoke(app, event("POST", "/designs", {"name": "n", "doc": doc}))[0] == 422


@pytest.mark.parametrize(
    ("method", "path", "wrap"),
    [
        ("POST", "/designs", lambda d: {"name": "n", "doc": d}),
        ("PATCH", f"/designs/{DID}", lambda d: {"expectedVersion": 1, "doc": d}),
    ],
    ids=["POST", "PATCH"],
)
def test_limite_de_350000_bytes_do_doc(app, method, path, wrap) -> None:  # type: ignore[no-untyped-def]
    at_limit = doc_of_size(MAX_DOC_BYTES)
    assert doc_size_bytes(DesignDocument.model_validate(at_limit)) == MAX_DOC_BYTES
    assert invoke(app, event(method, path, wrap(at_limit)))[0] == 501

    over = doc_of_size(MAX_DOC_BYTES + 1)
    assert doc_size_bytes(DesignDocument.model_validate(over)) == MAX_DOC_BYTES + 1
    status, _, problem = invoke(app, event(method, path, wrap(over)))
    assert status == 413
    assert problem["status"] == 413
    assert "errors" not in problem
    assert "é" * 64 not in json.dumps(problem, ensure_ascii=False)


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


def test_corpo_acima_do_teto_responde_413_antes_de_validar(app: FastAPI) -> None:
    at_limit = "{" + " " * (MAX_BODY_BYTES - 1)
    assert invoke(app, event("POST", "/designs", raw=at_limit))[0] == 422
    status, headers, problem = invoke(app, event("POST", "/designs", raw=at_limit + " "))
    assert (status, headers["content-type"], problem["status"]) == (413, PROBLEM, 413)
    assert "errors" not in problem


@pytest.mark.parametrize(
    "raw",
    ['{"name": "n", "doc": ' + "9" * 5000 + "}", "[" * 200_000 + "]" * 200_000],
    ids=["inteiro-de-5000-digitos", "200-mil-niveis"],
)
def test_json_que_o_parser_recusa_responde_400_sem_eco(app: FastAPI, raw: str) -> None:
    """`json.loads` levanta `ValueError`/`RecursionError` aqui: é 400, nunca 500."""
    status, headers, problem = invoke(app, event("POST", "/designs", raw=raw))
    assert (status, headers["content-type"]) == (400, PROBLEM)
    assert "9" * 20 not in json.dumps(problem)
