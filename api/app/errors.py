"""Erros HTTP no formato problem details (RFC 9457), num handler único."""

from collections.abc import Mapping
from http import HTTPStatus

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException

from app.logs import get_request_id

PROBLEM_MEDIA_TYPE = "application/problem+json"


def _build(
    status: int, detail: str | None, headers: Mapping[str, str] | None, extra: dict[str, object]
) -> JSONResponse:
    """Monta `{"type", "title", "status", "detail"?, ...extra, "requestId"}`."""
    title = HTTPStatus(status).phrase
    body: dict[str, object] = {"type": "about:blank", "title": title, "status": status}
    # O Starlette usa a própria frase HTTP como detail padrão (ex.: 404): não repete o title.
    if detail and detail != title:
        body["detail"] = detail
    body |= extra | {"requestId": get_request_id()}
    return JSONResponse(body, status, headers, media_type=PROBLEM_MEDIA_TYPE)


async def _handle(request: Request, exc: Exception) -> JSONResponse:
    if isinstance(exc, HTTPException):
        detail = exc.detail if isinstance(exc.detail, str) else None
        return _build(exc.status_code, detail, exc.headers, {})
    if isinstance(exc, RequestValidationError):
        # Só `loc` e `msg`: `input`, `ctx` e `url` ecoam o corpo enviado pelo usuário.
        errors = [{"loc": list(e["loc"]), "msg": e["msg"]} for e in exc.errors()]
        return _build(422, "Request validation failed", None, {"errors": errors})
    # Sem a mensagem da exceção, que pode trazer dado do usuário. O Starlette relança a exceção
    # depois desta resposta e o RequestLogMiddleware a registra em `app.error`.
    return _build(500, None, None, {})


def install_error_handlers(app: FastAPI) -> None:
    """Registra o mesmo handler para HTTPException, RequestValidationError e Exception."""
    for exc_class in (HTTPException, RequestValidationError, Exception):
        app.add_exception_handler(exc_class, _handle)
