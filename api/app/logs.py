"""Logs em JSON com id da requisição. Nunca registra cabeçalhos, corpo, query string nem e-mail."""

import logging

from starlette.types import ASGIApp, Receive, Scope, Send

ALLOWED_FIELDS: frozenset[str] = frozenset(
    {"method", "path", "status", "duration_ms", "error_type", "stack"}
)


def get_request_id() -> str:
    """Id da requisição corrente (ContextVar); "-" fora de uma requisição."""
    raise NotImplementedError


class JsonFormatter(logging.Formatter):
    """Uma linha JSON: timestamp, level, logger, message, request_id e extras de ALLOWED_FIELDS."""


def configure_logging(level: str) -> None:
    """Idempotente. Substitui os handlers do logger raiz por um StreamHandler(stdout) em JSON."""
    raise NotImplementedError


class RequestLogMiddleware:
    """Middleware ASGI puro, camada mais externa (fora do ServerErrorMiddleware do Starlette).

    Define o id (`scope["aws.context"].aws_request_id`, senão uuid4) e grava uma linha por
    requisição no logger `app.request`. A exceção que o Starlette relança depois de responder 500
    termina aqui, para o Mangum não registrá-la com a mensagem.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        raise NotImplementedError
