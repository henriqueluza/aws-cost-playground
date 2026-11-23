"""Erros HTTP no formato problem details (RFC 9457), num handler único."""

from fastapi import FastAPI
from fastapi.responses import JSONResponse

PROBLEM_MEDIA_TYPE = "application/problem+json"


def problem_response(
    status: int, *, detail: str | None = None, headers: dict[str, str] | None = None
) -> JSONResponse:
    """Monta `{"type", "title", "status", "detail"?, "requestId"}` com o media type de problem."""
    raise NotImplementedError


def install_error_handlers(app: FastAPI) -> None:
    """Registra o mesmo handler para HTTPException, RequestValidationError e Exception."""
    raise NotImplementedError
