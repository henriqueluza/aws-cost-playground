"""Quotas de estimativa: o teto de gasto com a LLM (ADR-0001, ameaça T1).

Falha fechada: interruptor desligado, erro do DynamoDB ou resposta inesperada nunca autorizam
uma estimativa. A quota é consumida antes da chamada à LLM e não é devolvida se ela falhar.
"""

import logging
import re
from collections.abc import Callable
from datetime import UTC, date, datetime, timedelta
from typing import Any

from fastapi import HTTPException

from app.config import Settings, get_settings
from app.dynamo import get_table
from app.errors import ProblemError
from app.quotas import repository
from app.quotas.repository import Scope
from app.quotas.schemas import QuotaOut

TTL_SECONDS = 35 * 24 * 60 * 60
# Mesmo formato do `auth.py`: o `sub` é conferido de novo antes de virar chave de partição.
SUB_PATTERN = re.compile(r"[A-Za-z0-9-]{1,128}")
Clock = Callable[[], datetime]

_logger = logging.getLogger("app.quota")


class QuotaExhausted(ProblemError):
    """429 com `scope` (qual limite estourou) e `resetsAt` (próxima meia-noite UTC)."""

    def __init__(self, scope: Scope, resets_at: str) -> None:
        super().__init__(429, {"scope": scope, "resetsAt": resets_at})
        self.scope: Scope = scope
        self.resets_at = resets_at


class QuotaUnavailable(HTTPException):
    """503 sem detalhe: a estimativa não é autorizada."""

    def __init__(self) -> None:
        super().__init__(503)


def _utc_now() -> datetime:
    return datetime.now(UTC)


def _unavailable(reason: str, message: str = "quota unavailable") -> QuotaUnavailable:
    _logger.error(message, extra={"error_type": reason})
    return QuotaUnavailable()


def _window(sub: str, now: Clock) -> tuple[date, str, int]:
    """Dia UTC do servidor, `resetsAt` e o instante em epoch. O fuso do cliente não entra."""
    if not SUB_PATTERN.fullmatch(sub):
        raise _unavailable("InvalidSub")
    moment = now()
    if moment.utcoffset() is None:
        raise _unavailable("NaiveClock")
    day = moment.astimezone(UTC).date()
    return day, f"{(day + timedelta(days=1)).isoformat()}T00:00:00Z", int(moment.timestamp())


def _user_state(table: Any, settings: Settings, sub: str, day: date, resets_at: str) -> QuotaOut:
    try:
        count = repository.user_count(table, sub=sub, day=day)
    except repository.StoreUnavailable as exc:
        raise _unavailable(exc.reason, "quota read failed") from None
    limit = settings.quota_user_daily_limit
    return QuotaOut.model_validate(
        {"limit": limit, "remaining": max(0, limit - count), "resetsAt": resets_at}
    )


def consume(
    sub: str, *, table: Any = None, settings: Settings | None = None, now: Clock = _utc_now
) -> QuotaOut:
    """Consome uma estimativa do usuário e uma da quota global, ou nenhuma.

    Chame antes da LLM. Levanta `QuotaExhausted` (429) quando um limite estourou e
    `QuotaUnavailable` (503) com `LLM_ENABLED=false` ou em qualquer falha. Se a leitura do
    restante falhar depois do incremento, a quota fica consumida e a resposta é 503.
    """
    settings = settings or get_settings()
    if not settings.llm_enabled:
        raise _unavailable("LlmDisabled", "llm disabled")
    day, resets_at, epoch = _window(sub, now)
    table = table or get_table()
    limits = {"user": settings.quota_user_daily_limit, "global": settings.quota_global_daily_limit}
    try:
        repository.increment(
            table,
            sub=sub,
            day=day,
            user_limit=limits["user"],
            global_limit=limits["global"],
            ttl=epoch + TTL_SECONDS,
        )
    except repository.LimitReached as exc:
        extra = {"scope": exc.scope, "limit": limits[exc.scope], "sub": sub}
        _logger.warning("quota exhausted", extra=extra)
        raise QuotaExhausted(exc.scope, resets_at) from None
    except repository.StoreUnavailable as exc:
        raise _unavailable(exc.reason) from None
    state = _user_state(table, settings, sub, day, resets_at)
    extra = {"scope": "user", "count": state.limit - state.remaining, "limit": state.limit}
    _logger.info("quota consumed", extra=extra | {"sub": sub})
    return state


def read(
    sub: str, *, table: Any = None, settings: Settings | None = None, now: Clock = _utc_now
) -> QuotaOut:
    """Quota do usuário sem consumir. Só lê o item do próprio `sub`; não reflete a global."""
    day, resets_at, _ = _window(sub, now)
    return _user_state(table or get_table(), settings or get_settings(), sub, day, resets_at)
