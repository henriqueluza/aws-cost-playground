"""Logs em JSON com id da requisição. Nunca registra cabeçalhos, corpo, query string nem e-mail."""

import json
import logging
import sys
from contextvars import ContextVar
from datetime import UTC, datetime
from time import perf_counter
from uuid import uuid4

from starlette.types import ASGIApp, Message, Receive, Scope, Send

ALLOWED_FIELDS: frozenset[str] = frozenset(
    {"method", "path", "status", "duration_ms", "error_type", "stack"}
)


_request_id: ContextVar[str] = ContextVar("request_id", default="-")
_request_logger = logging.getLogger("app.request")


def get_request_id() -> str:
    """Id da requisição corrente (ContextVar); "-" fora de uma requisição."""
    return _request_id.get()


class JsonFormatter(logging.Formatter):
    """Uma linha JSON: timestamp, level, logger, message, request_id e extras de ALLOWED_FIELDS."""

    def format(self, record: logging.LogRecord) -> str:
        # exc_info/stack_info ficam de fora de propósito: quem precisa manda `stack` explícito.
        data = {
            "timestamp": datetime.fromtimestamp(record.created, UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "request_id": get_request_id(),
        }
        data.update({k: v for k, v in record.__dict__.items() if k in ALLOWED_FIELDS})
        return json.dumps(data, ensure_ascii=False, default=str)


def configure_logging(level: str) -> None:
    """Idempotente. Substitui os handlers do logger raiz por um StreamHandler(stdout) em JSON."""
    handler = logging.StreamHandler(sys.stdout)  # liga ao stdout vigente na chamada
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level.upper())
    logging.getLogger("mangum").setLevel(logging.WARNING)  # a linha de acesso é a de app.request


class RequestLogMiddleware:
    """Middleware ASGI puro, camada mais externa (fora do ServerErrorMiddleware do Starlette).

    Define o id (`scope["aws.context"].aws_request_id`, senão uuid4) e grava uma linha por
    requisição no logger `app.request`. A exceção que o Starlette relança depois de responder 500
    termina aqui, para o Mangum não registrá-la com a mensagem.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        context = scope.get("aws.context")
        token = _request_id.set(getattr(context, "aws_request_id", None) or uuid4().hex)
        status: int | None = None

        async def capture(message: Message) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
            await send(message)

        start = perf_counter()
        try:
            await self.app(scope, receive, capture)
        except Exception:
            if status is None:
                raise  # resposta não começou: deixa o Mangum tratar
        finally:
            _request_logger.info(
                "request",
                extra={
                    "method": scope["method"],
                    "path": scope["path"],
                    "status": status or 500,
                    "duration_ms": round((perf_counter() - start) * 1000, 2),
                },
            )
            _request_id.reset(token)
