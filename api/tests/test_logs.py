import asyncio
import json
import logging
from typing import Any

import pytest
from fastapi import FastAPI

from app.logs import JsonFormatter, RequestLogMiddleware, configure_logging, get_request_id
from tests.conftest import FakeContext, invoke, make_event


def _probe_app() -> FastAPI:
    probe = FastAPI()
    probe.post("/x")(lambda: {"ok": True})
    probe.get("/boom")(lambda: 1 / 0)
    return probe


def _request_lines(out: str) -> list[dict[str, Any]]:
    lines = [json.loads(line) for line in out.splitlines() if line]
    return [x for x in lines if x["logger"] == "app.request"]


def test_request_log_has_id_and_no_sensitive_data(capsys: pytest.CaptureFixture[str]) -> None:
    configure_logging("INFO")  # com o capsys ativo, o handler liga ao stdout capturado
    headers = {"authorization": "Bearer secret-token", "x-user-email": "someone@example.com"}
    event = make_event(
        "/x",
        headers=headers,
        query="email=someone@example.com",
        body='{"email":"someone@example.com"}',
        method="POST",
    )
    status, _, _ = invoke(_probe_app(), event)
    out = capsys.readouterr().out
    assert "secret-token" not in out and "someone@example.com" not in out
    (line,) = _request_lines(out)
    assert (line["request_id"], line["method"], line["path"], line["status"]) == (
        "req-test-1",
        "POST",
        "/x",
        status,
    )
    assert line["duration_ms"] >= 0
    assert get_request_id() == "-"


def test_fallback_id_is_uuid_hex(capsys: pytest.CaptureFixture[str]) -> None:
    configure_logging("INFO")

    async def asgi(scope: Any, receive: Any, send: Any) -> None:
        await send({"type": "http.response.start", "status": 204, "headers": []})

    async def send(_: Any) -> None: ...

    scope: Any = {"type": "http", "method": "GET", "path": "/y"}
    asyncio.run(RequestLogMiddleware(asgi)(scope, None, send))  # type: ignore[arg-type]
    (line,) = _request_lines(capsys.readouterr().out)
    assert len(line["request_id"]) == 32 and int(line["request_id"], 16) >= 0
    assert line["status"] == 204


def test_formatter_drops_fields_outside_allowlist() -> None:
    record = logging.LogRecord("t", logging.INFO, "f", 1, "m", None, None)
    record.email = "x@y.z"
    record.status = 200
    data = json.loads(JsonFormatter().format(record))
    assert "email" not in data and data["status"] == 200


def test_unhandled_exception_returns_500_and_is_absorbed(
    capsys: pytest.CaptureFixture[str],
) -> None:
    from app.main import create_handler  # import tardio: main lê as variáveis de ambiente

    configure_logging("INFO")
    response = create_handler(_probe_app())(make_event("/boom"), FakeContext())
    assert response["statusCode"] == 500
    assert [x["status"] for x in _request_lines(capsys.readouterr().out)] == [500]
