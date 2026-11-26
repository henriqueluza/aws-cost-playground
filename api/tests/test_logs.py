import asyncio
import json
import logging
from typing import Any

import pytest
from fastapi import FastAPI

from app.logs import JsonFormatter, RequestLogMiddleware, configure_logging, get_request_id
from tests.conftest import FakeContext, invoke, make_event

EMAIL = "someone@example.com"


def _probe_app() -> FastAPI:
    probe = FastAPI()
    probe.post("/x/{key}")(lambda key: {"ok": True})
    probe.get("/boom")(lambda: 1 / 0)
    return probe


def _lines(out: str, logger: str) -> list[dict[str, Any]]:
    return [x for x in map(json.loads, filter(None, out.splitlines())) if x["logger"] == logger]


def _run_asgi(asgi: Any) -> None:
    async def send(_: Any) -> None: ...

    scope: Any = {"type": "http", "method": "GET", "path": "/y"}
    asyncio.run(RequestLogMiddleware(asgi)(scope, None, send))


def test_request_log_has_id_and_no_sensitive_data(capsys: pytest.CaptureFixture[str]) -> None:
    configure_logging("INFO")  # com o capsys ativo, o handler liga ao stdout capturado
    headers = {"authorization": "Bearer secret-token", "x-user-email": EMAIL}
    event = make_event(
        f"/x/{EMAIL}",
        method="POST",
        headers=headers,
        query=f"email={EMAIL}",
        body=f'{{"email":"{EMAIL}"}}',
    )
    status, _, _ = invoke(_probe_app(), event)
    out = capsys.readouterr().out
    assert "secret-token" not in out and EMAIL not in out
    (line,) = _lines(out, "app.request")
    assert (line["request_id"], line["method"], line["route"], line["status"]) == (
        "req-test-1",
        "POST",
        "/x/{key}",  # o template da rota, nunca o path com o e-mail
        status,
    )
    assert line["duration_ms"] >= 0
    assert get_request_id() == "-"


def test_unmatched_route_is_not_logged_raw(capsys: pytest.CaptureFixture[str]) -> None:
    configure_logging("INFO")
    status, _, _ = invoke(_probe_app(), make_event(f"/nope/{EMAIL}"))
    out = capsys.readouterr().out
    assert status == 404 and EMAIL not in out
    assert _lines(out, "app.request")[0]["route"] == "<unmatched>"


def test_fallback_id_is_uuid_hex(capsys: pytest.CaptureFixture[str]) -> None:
    configure_logging("INFO")

    async def asgi(scope: Any, receive: Any, send: Any) -> None:
        await send({"type": "http.response.start", "status": 204, "headers": []})

    _run_asgi(asgi)
    (line,) = _lines(capsys.readouterr().out, "app.request")
    assert len(line["request_id"]) == 32 and int(line["request_id"], 16) >= 0
    assert line["status"] == 204


@pytest.mark.parametrize("started", [False, True])
def test_unhandled_error_is_logged_once(started: bool, capsys: pytest.CaptureFixture[str]) -> None:
    configure_logging("INFO")

    async def asgi(scope: Any, receive: Any, send: Any) -> None:
        if started:  # ex.: falha no meio do corpo
            await send({"type": "http.response.start", "status": 200, "headers": []})
        raise RuntimeError(EMAIL)

    if started:
        _run_asgi(asgi)  # absorvida: a resposta já começou
    else:
        with pytest.raises(RuntimeError):  # sem resposta: o Mangum trata
            _run_asgi(asgi)
    out = capsys.readouterr().out
    assert EMAIL not in out
    [error] = _lines(out, "app.error")
    assert (error["level"], error["error_type"]) == ("ERROR", "RuntimeError")
    assert [x["status"] for x in _lines(out, "app.request")] == [200 if started else 500]


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
    out = capsys.readouterr().out
    assert [x["status"] for x in _lines(out, "app.request")] == [500]
    assert [x["error_type"] for x in _lines(out, "app.error")] == ["ZeroDivisionError"]


def test_non_http_scope_passes_through_without_log(capsys: pytest.CaptureFixture[str]) -> None:
    configure_logging("INFO")
    seen: list[str] = []

    async def asgi(scope: Any, receive: Any, send: Any) -> None:
        seen.append(scope["type"])

    asyncio.run(RequestLogMiddleware(asgi)({"type": "lifespan"}, None, None))  # type: ignore[arg-type]
    assert seen == ["lifespan"] and capsys.readouterr().out == ""
