"""Estimativa de uso: onde o teto de gasto com a LLM é aplicado (ADR-0001, ameaça T1).

A ordem é o controle: tamanho e interruptor (`prepare`, sem rede) → quota (`consume`) → uma
chamada à LLM (`estimate`). Entrada recusada ou interruptor desligado não consomem quota; sem
quota confirmada a LLM não é chamada; falha da LLM depois do consumo não devolve a quota (devolver
abriria repetição gratuita: bastaria provocar a falha). Não há nova tentativa aqui.
"""

import logging
from time import perf_counter

from fastapi import HTTPException

from app.estimates.claude_client import ClaudeClient, ErrorCode, EstimateError
from app.estimates.revalidation import ItemUsage
from app.estimates.schemas import EstimateIn, EstimateOut
from app.quotas.service import QuotaExhausted, QuotaUnavailable, consume

RETRY_AFTER_SECONDS = "30"
# Código interno → (status, Retry-After). O `web/` lê só o status: 413 é `too-large`; 502 e 503
# são `unavailable`. 502 separa "a LLM respondeu algo inutilizável" de "não deu para chamar".
_STATUS: dict[ErrorCode, tuple[int, str | None]] = {
    "too_large": (413, None),
    "disabled": (503, None),
    "unavailable": (503, None),
    "timeout": (503, RETRY_AFTER_SECONDS),
    "rate_limited": (503, RETRY_AFTER_SECONDS),
    "overloaded": (503, RETRY_AFTER_SECONDS),
    "refused": (502, None),
    "truncated": (502, None),
    "invalid_output": (502, None),
}
# Texto fixo por status: nada da LLM, da Anthropic ou da AWS chega à resposta.
_DETAIL = {
    413: "The diagram is too large to estimate.",
    502: "The estimate failed.",
    503: "Estimates are unavailable.",
}
_logger = logging.getLogger("app.estimate")


def _problem(code: ErrorCode) -> HTTPException:
    status, retry_after = _STATUS[code]
    headers = {"Retry-After": retry_after} if retry_after else None
    return HTTPException(status, _DETAIL[status], headers)


def _items(items: tuple[ItemUsage, ...]) -> list[dict[str, object]]:
    return [{"id": item.id, "values": item.values, "source": item.source} for item in items]


def estimate_usage(sub: str, body: EstimateIn, client: ClaudeClient) -> EstimateOut:
    """Consome uma estimativa da quota de `sub` e devolve só ids, números e o restante da quota.

    As exceções da quota (429 e 503) sobem como vieram. Um evento `app.estimate` por chamada
    registra duração, tokens e resultado, sem conteúdo do pedido nem da resposta.
    """
    start = perf_counter()
    result, tokens, consumed = "error", (0, 0), False
    try:
        plan = client.prepare(body)  # tamanho e interruptor: sem rede, sem custo, sem quota
        quota = consume(sub)  # levanta se não autorizar: nada abaixo roda
        consumed = True
        usage = client.estimate(plan)  # a única chamada paga
        tokens = (usage.input_tokens, usage.output_tokens)
        response = EstimateOut.model_validate(
            {"blocks": _items(usage.blocks), "edges": _items(usage.edges), "quota": quota}
        )
        result = "ok"
        return response
    except EstimateError as exc:
        result, tokens = exc.code, (exc.input_tokens, exc.output_tokens)
        raise _problem(exc.code) from None
    except QuotaExhausted:
        result = "quota_exhausted"
        raise
    except QuotaUnavailable:
        # Pode ter consumido: se a leitura do restante falha depois do incremento, a #60 responde
        # 503 e a quota fica gasta. O evento `quota read failed` do mesmo request_id diz qual foi.
        result = "quota_unavailable"
        raise
    finally:
        if result == "ok":
            level, message = logging.INFO, "estimate completed"
        elif consumed:  # quota gasta sem estimativa entregue: não é devolvida
            level, message = logging.ERROR, "estimate failed after quota consumed"
        else:
            level, message = logging.WARNING, "estimate rejected"
        _logger.log(
            level,
            message,
            extra={
                "result": result,
                "duration_ms": round((perf_counter() - start) * 1000, 2),
                "input_tokens": tokens[0],
                "output_tokens": tokens[1],
                "block_count": len(body.blocks),
                "edge_count": len(body.edges),
                "sub": sub,
            },
        )
