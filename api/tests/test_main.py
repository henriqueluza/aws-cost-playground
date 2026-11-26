import importlib
from typing import Any

import pytest
from fastapi import FastAPI
from mangum import Mangum

from tests.conftest import FakeContext, invoke, make_event


def test_handler_e_create_handler_sao_mangum(app: FastAPI) -> None:
    from app.main import create_handler, handler

    assert isinstance(handler, Mangum)
    assert isinstance(create_handler(app), Mangum)


@pytest.mark.parametrize("path", ["/docs", "/redoc", "/openapi.json"])
def test_documentacao_automatica_desligada(app: FastAPI, path: str) -> None:
    status, _, _ = invoke(app, make_event(path))
    assert status == 404


@pytest.mark.parametrize("name", ["designs", "estimates", "quotas", "account"])
def test_pacotes_de_dominio_existem(name: str) -> None:
    importlib.import_module(f"app.{name}")


def raw_response(app: FastAPI, event: dict[str, Any]) -> dict[str, Any]:
    """A resposta crua do handler da Lambda, com os cabeçalhos como o API Gateway os recebe."""
    from app.main import create_handler

    response: dict[str, Any] = create_handler(app)(event, FakeContext())
    return response


# CORS é só do API Gateway (uma origem, a do site): a aplicação não responde preflight nem ecoa origem.
@pytest.mark.parametrize("method", ["OPTIONS", "GET", "POST", "DELETE"])
@pytest.mark.parametrize("path", ["/estimates", "/quota", "/designs", "/me", "/nao-existe"])
@pytest.mark.parametrize("claims", [None, {"sub": "3f1c2b9e-8d47-4a6b-9c11-5e2a7d0b4f63"}])
def test_aplicacao_nunca_emite_cabecalho_de_cors(
    app: FastAPI, method: str, path: str, claims: dict[str, str] | None
) -> None:
    headers = {"origin": "https://evil.example", "access-control-request-method": "POST"}
    event = make_event(path, method=method, claims=claims, headers=headers, body="{}")
    response = raw_response(app, event)
    assert not [name for name in response["headers"] if name.lower().startswith("access-control-")]
    assert "multiValueHeaders" not in response


def test_aplicacao_nao_tem_middleware_de_cors(app: FastAPI) -> None:
    assert "CORSMiddleware" not in [middleware.cls.__name__ for middleware in app.user_middleware]
