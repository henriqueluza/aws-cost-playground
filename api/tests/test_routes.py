import json
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.routing import APIRoute

from app.design_document import DesignDocument, doc_size_bytes
from tests.conftest import invoke, make_event

SUB = "8f14e45f-ceea-467f-a0e6-1a2b3c4d5e6f"
DID = "01JD0000000000000000000000"
MAX_DOC_BYTES = 350_000


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
    blocks = [
        {"id": f"blk_{i}", "type": "aws.s3", "label": "b", "usage": usage, "overrides": {}}
        for i in range(100)
    ]
    doc = make_doc() | {"blocks": blocks}

    def size() -> int:
        return len(json.dumps(doc, separators=(",", ":"), ensure_ascii=False).encode())

    for block in blocks:
        block["attributes"] = {}
    slots = [(b["attributes"], f"a{k}") for k in range(32) for b in blocks]

    def fill(count: int) -> None:
        for i, (attrs, key) in enumerate(slots):
            if i < count:
                attrs[key] = "é" * 64
            else:
                attrs.pop(key, None)

    low, high = 0, len(slots)  # busca binária: maior nº de atributos cheios que cabe no alvo
    while low < high:
        mid = (low + high + 1) // 2
        fill(mid)
        low, high = (mid, high) if size() <= target else (low, mid - 1)
    fill(low)
    slots = slots[low : low + 1]
    for attrs, key in slots:  # ajuste fino com um atributo novo, de 0 a 128 bytes
        for wide in range(65):
            for narrow in range(65 - wide):
                attrs[key] = "é" * wide + "a" * narrow
                if size() == target:
                    return doc
        attrs.pop(key, None)
    pytest.fail("não achou o tamanho exato")


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


def api_routes(routes: Any, prefix: str = "") -> set[tuple[str, str]]:
    """(método, path) das APIRoute; o FastAPI recente embrulha routers incluídos."""
    found: set[tuple[str, str]] = set()
    for route in routes:
        if isinstance(route, APIRoute):
            found |= {(m, prefix + route.path) for m in route.methods}
        elif hasattr(route, "original_router"):
            found |= api_routes(route.original_router.routes, prefix + route.include_context.prefix)
    return found


def test_conjunto_exato_de_rotas(app: FastAPI) -> None:
    want = {(m, p.replace(DID, "{design_id}")) for m, p, *_ in ROUTES}
    assert api_routes(app.routes) == want


@pytest.mark.parametrize(("method", "path", "valid", "invalid", "_ok"), ROUTES, ids=IDS)
def test_sem_claim_responde_401(app, method, path, valid, invalid, _ok) -> None:  # type: ignore[no-untyped-def]
    for body in (valid, invalid):
        status, headers, problem = invoke(app, event(method, path, body, auth=False))
        assert status == 401
        assert headers["www-authenticate"] == "Bearer"
        assert headers["content-type"] == "application/problem+json"
        assert problem["title"] == "Unauthorized"


@pytest.mark.parametrize(("method", "path", "valid", "invalid", "_ok"), ROUTES, ids=IDS)
def test_com_claim_e_corpo_valido_responde_501(app, method, path, valid, invalid, _ok) -> None:  # type: ignore[no-untyped-def]
    status, headers, problem = invoke(app, event(method, path, valid))
    assert (status, problem["status"]) == (501, 501)
    assert headers["content-type"] == "application/problem+json"


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


def test_json_malformado_sem_identidade_responde_422(app: FastAPI) -> None:
    # Comportamento conhecido, não requisito: o FastAPI lê o corpo antes das dependências (auth).
    status, _, _ = invoke(app, event("POST", "/designs", auth=False, raw="{"))
    assert status == 422
