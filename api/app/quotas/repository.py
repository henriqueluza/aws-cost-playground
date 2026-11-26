"""Contadores de quota na tabela única (ADR-0001, "Modelo de dados").

| Item | PK | SK | Atributos |
|---|---|---|---|
| Quota do usuário | `USER#<sub>` | `QUOTA#<aaaa-mm-dd>` | `count`, `ttl` |
| Quota global | `GLOBAL` | `QUOTA#<aaaa-mm-dd>` | `count`, `ttl` |

O papel do `llm-proxy` só tem `dynamodb:GetItem` e `dynamodb:UpdateItem`: a transação leva só
operações `Update`, que a AWS autoriza pela ação `UpdateItem`.
"""

from datetime import date
from decimal import Decimal
from typing import Any, Literal

from botocore.exceptions import BotoCoreError, ClientError

Scope = Literal["user", "global"]

_CONDITION_FAILED = "ConditionalCheckFailed"
# O item nasce no primeiro `Update` do dia: o `ttl` entra por `if_not_exists` e a condição aceita
# o contador ainda ausente (`count < :limit` sozinho recusaria a primeira estimativa do dia).
_UPDATE = "SET #ttl = if_not_exists(#ttl, :ttl) ADD #count :one"
_CONDITION = "attribute_not_exists(#count) OR #count < :limit"
_NAMES = {"#count": "count", "#ttl": "ttl"}


class LimitReached(Exception):
    """A condição de limite de um contador falhou; nenhum dos dois foi incrementado."""

    def __init__(self, scope: Scope) -> None:
        super().__init__(scope)
        self.scope: Scope = scope


class StoreUnavailable(Exception):
    """Erro do DynamoDB ou resposta fora do esperado. `reason` é um rótulo curto para o log."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


def user_key(sub: str, day: date) -> dict[str, str]:
    return {"PK": f"USER#{sub}", "SK": f"QUOTA#{day.isoformat()}"}


def global_key(day: date) -> dict[str, str]:
    return {"PK": "GLOBAL", "SK": f"QUOTA#{day.isoformat()}"}


def _update(table_name: str, key: dict[str, str], limit: int, ttl: int) -> dict[str, Any]:
    return {
        "Update": {
            "TableName": table_name,
            "Key": key,
            "UpdateExpression": _UPDATE,
            "ConditionExpression": _CONDITION,
            "ExpressionAttributeNames": _NAMES,
            "ExpressionAttributeValues": {":one": 1, ":limit": limit, ":ttl": ttl},
        }
    }


def _canceled(exc: ClientError) -> LimitReached | StoreUnavailable:
    """Traduz o erro da transação. Só `CancellationReasons` sem ambiguidade vira `LimitReached`."""
    code = exc.response.get("Error", {}).get("Code")
    if code != "TransactionCanceledException":
        return StoreUnavailable(code if isinstance(code, str) else "ClientError")
    reasons = exc.response.get("CancellationReasons")
    found = reasons if isinstance(reasons, list) else []
    codes = [reason.get("Code") for reason in found if isinstance(reason, dict)]
    # Ordem dos motivos = ordem dos itens: [usuário, global]. Com os dois estourados vence `user`.
    if len(codes) == 2 and _CONDITION_FAILED in codes and set(codes) <= {"None", _CONDITION_FAILED}:
        return LimitReached("user" if codes[0] == _CONDITION_FAILED else "global")
    return StoreUnavailable("TransactionCanceled")


def increment(
    table: Any, *, sub: str, day: date, user_limit: int, global_limit: int, ttl: int
) -> None:
    """Soma 1 aos dois contadores numa única `TransactWriteItems`, ou a nenhum.

    Cada `Update` leva a condição "abaixo do limite": requisições simultâneas nunca passam de
    nenhum dos dois, e estourar um não consome o outro. Levanta `LimitReached` ou
    `StoreUnavailable`. O botocore gera o `ClientRequestToken`, então a nova tentativa
    automática da mesma chamada não conta duas vezes.
    """
    items = [
        _update(table.name, user_key(sub, day), user_limit, ttl),
        _update(table.name, global_key(day), global_limit, ttl),
    ]
    try:
        table.meta.client.transact_write_items(TransactItems=items)
    except ClientError as exc:
        raise _canceled(exc) from None
    except BotoCoreError as exc:
        raise StoreUnavailable(type(exc).__name__) from None


def user_count(table: Any, *, sub: str, day: date) -> int:
    """Lê o contador do usuário com `GetItem` consistente. Item ausente vale 0."""
    try:
        response = table.get_item(
            Key=user_key(sub, day),
            ConsistentRead=True,
            ProjectionExpression="#count",
            ExpressionAttributeNames={"#count": "count"},
        )
    except (BotoCoreError, ClientError) as exc:
        raise StoreUnavailable(type(exc).__name__) from None
    absent = {"count": Decimal(0)}
    item = response.get("Item", absent) if isinstance(response, dict) else None
    count = item.get("count") if isinstance(item, dict) else None
    if isinstance(count, Decimal) and count >= 0 and count == count.to_integral_value():
        return int(count)
    raise StoreUnavailable("UnexpectedResponse")
