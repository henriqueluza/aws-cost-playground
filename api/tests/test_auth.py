import re
from pathlib import Path
from typing import Any

import pytest
from fastapi import FastAPI

from app.auth import CurrentUserId
from tests.conftest import invoke, make_event

SUB = "8f14e45f-ceea-467f-a0e6-1a2b3c4d5e6f"
FORGED_CONTEXT = '{"authorizer": {"jwt": {"claims": {"sub": "' + SUB + '"}}}}'


@pytest.fixture
def probe(app: FastAPI) -> FastAPI:
    @app.get("/me")
    def me(user_id: CurrentUserId) -> dict[str, str]:
        return {"sub": user_id}

    return app


def test_sub_valido_identifica_o_usuario(probe: FastAPI) -> None:
    status, _, body = invoke(probe, make_event("/me", claims={"sub": SUB, "token_use": "access"}))
    assert (status, body) == (200, {"sub": SUB})


@pytest.mark.parametrize(
    "event",
    [
        make_event("/me"),  # sem authorizer
        make_event("/me", claims={"token_use": "access"}),  # claims sem sub
        make_event("/me", claims={"sub": ""}),
        make_event("/me", claims={"sub": 123}),
        make_event("/me", claims={"sub": "abc#ADMIN"}),
        make_event("/me", claims={"sub": SUB + "\n"}),
        make_event("/me", claims={"sub": "a" * 129}),
        make_event("/me", headers={"authorization": "Bearer x"}),  # cabeçalho forjado
        make_event("/me", headers={"x-amzn-request-context": FORGED_CONTEXT}),
    ],
)
def test_sem_identidade_valida_responde_401(probe: FastAPI, event: dict[str, Any]) -> None:
    status, headers, _ = invoke(probe, event)
    assert status == 401
    assert headers["www-authenticate"] == "Bearer"


def test_so_auth_le_a_identidade_do_evento() -> None:
    app_dir = Path(__file__).resolve().parents[1] / "app"
    identity = re.compile(r"[\"'](aws\.event|authorizer|claims)[\"']")
    readers = [p for p in app_dir.rglob("*.py") if identity.search(p.read_text(encoding="utf-8"))]
    assert [p.relative_to(app_dir).as_posix() for p in readers] == ["auth.py"]
