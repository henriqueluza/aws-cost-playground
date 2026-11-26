"""Itens de design na tabela única (ADR-0001): `PK = USER#<sub>`, `SK = DESIGN#<ulid>`.

Toda chave sai de `_key`/`_pk`, a partir do `sub` do JWT. Só `GetItem`, `PutItem`, `UpdateItem`,
`DeleteItem` e `Query`, as ações que a política do papel da função concede
(`infra/modules/functions/iam.tf`); nunca `Scan`. Falha do DynamoDB vira
`StoreUnavailable`/`StoreFailure` e uma linha de log só com o código do erro.
"""

import logging
import re
from collections.abc import Iterator
from contextlib import contextmanager
from decimal import Decimal
from typing import Any

from boto3.dynamodb.conditions import Key
from botocore.exceptions import BotoCoreError, ClientError, HTTPClientError
from botocore.exceptions import ConnectionError as BotoConnectionError

from app.auth import SUB_PATTERN
from app.designs.errors import (
    DesignError,
    DesignNotFound,
    StoreFailure,
    StoreUnavailable,
    VersionConflict,
)
from app.designs.schemas import DESIGN_ID_PATTERN
from app.dynamo import get_table

USER_PREFIX = "USER#"
DESIGN_PREFIX = "DESIGN#"
_UNAVAILABLE_CODES = frozenset(
    {
        "ProvisionedThroughputExceededException",
        "ThrottlingException",
        "RequestLimitExceeded",
        "InternalServerError",
        "ServiceUnavailable",
    }
)
_CONDITION_FAILED = "ConditionalCheckFailedException"
_ERROR_CODE = re.compile(r"[A-Za-z0-9.]{1,80}")
# Tudo menos `doc` (ADR-0001). `name` e `region` são palavras reservadas do DynamoDB.
_SUMMARY_PROJECTION = (
    "SK, #name, #region, schemaVersion, blockCount, sizeBytes, createdAt, updatedAt, version"
)
_SUMMARY_NAMES = {"#name": "name", "#region": "region"}
_logger = logging.getLogger("app.designs")


def _pk(user_id: str) -> str:
    # `auth.py` já validou; repetir aqui impede que outro chamador monte uma chave com `#`.
    if not SUB_PATTERN.fullmatch(user_id):
        raise ValueError("invalid user id")
    return USER_PREFIX + user_id


def _key(user_id: str, design_id: str) -> dict[str, str]:
    if not re.fullmatch(DESIGN_ID_PATTERN, design_id):
        raise ValueError("invalid design id")
    return {"PK": _pk(user_id), "SK": DESIGN_PREFIX + design_id}


def _translate(exc: ClientError | BotoCoreError) -> DesignError:
    """Registra só o código do erro (a mensagem da AWS traz ARN da tabela e do papel)."""
    if isinstance(exc, ClientError):
        raw = str(exc.response.get("Error", {}).get("Code", ""))
        code = raw if _ERROR_CODE.fullmatch(raw) else "Unknown"
        unavailable = code in _UNAVAILABLE_CODES
    else:
        code = type(exc).__name__
        unavailable = isinstance(exc, BotoConnectionError | HTTPClientError)
    _logger.error("dynamodb error", extra={"error_type": code})
    return StoreUnavailable() if unavailable else StoreFailure()


@contextmanager
def _store_errors(*, tolerate: str | None = None) -> Iterator[list[str]]:
    """Traduz falhas do boto3. O código `tolerate`, se ocorrer, vai para a lista em vez de erro."""
    tolerated: list[str] = []
    try:
        yield tolerated
    except ClientError as exc:
        if tolerate is not None and exc.response.get("Error", {}).get("Code") == tolerate:
            tolerated.append(tolerate)
            return
        raise _translate(exc) from None
    except BotoCoreError as exc:
        raise _translate(exc) from None


def _record(item: dict[str, Any]) -> dict[str, Any]:
    """Item sem as chaves, com `id` e números do DynamoDB (`Decimal`) como `int`/`float`."""
    record: dict[str, Any] = {"id": str(item.get("SK", "")).removeprefix(DESIGN_PREFIX)}
    for name, value in item.items():
        if name in ("PK", "SK"):
            continue
        if isinstance(value, Decimal):
            value = int(value) if value == value.to_integral_value() else float(value)
        record[name] = value
    return record


def _pages(user_id: str, **params: Any) -> Iterator[dict[str, Any]]:
    """Todas as páginas da `Query` dos designs do usuário (o DynamoDB corta cada uma em 1 MB)."""
    params["KeyConditionExpression"] = Key("PK").eq(_pk(user_id)) & Key("SK").begins_with(
        DESIGN_PREFIX
    )
    while True:
        with _store_errors():
            page: dict[str, Any] = get_table().query(ConsistentRead=True, **params)
        yield page
        if "LastEvaluatedKey" not in page:
            return
        params["ExclusiveStartKey"] = page["LastEvaluatedKey"]


def put_new(user_id: str, design_id: str, attributes: dict[str, Any]) -> bool:
    """Grava um design novo. `False` se o id já existe na partição (nada é sobrescrito)."""
    item = _key(user_id, design_id) | attributes
    with _store_errors(tolerate=_CONDITION_FAILED) as exists:
        get_table().put_item(Item=item, ConditionExpression="attribute_not_exists(PK)")
    return not exists


def get(user_id: str, design_id: str) -> dict[str, Any] | None:
    key = _key(user_id, design_id)
    with _store_errors():
        item = get_table().get_item(Key=key, ConsistentRead=True).get("Item")
    return None if item is None else _record(item)


def update(
    user_id: str, design_id: str, expected_version: int, attributes: dict[str, Any]
) -> dict[str, Any]:
    """Grava `attributes` e `version + 1` só se a `version` gravada é `expected_version`.

    Escrita condicional, sem ler antes: a condição decide. Na recusa, o item antigo que o
    DynamoDB devolve só diz se ele existe (`VersionConflict`) ou não (`DesignNotFound`); a
    condição `attribute_exists(PK)` impede que o `UpdateItem` crie um item novo. Os nomes dos
    atributos vêm do serviço, nunca do corpo, e entram como `#aN` (nada de nome no texto).
    """
    if not attributes or attributes.keys() & {"PK", "SK", "version"}:
        raise ValueError("invalid update attributes")
    key = _key(user_id, design_id)
    names = {f"#a{i}": name for i, name in enumerate(attributes)}
    values = {f":a{i}": value for i, value in enumerate(attributes.values())}
    sets = "".join(f"#a{i} = :a{i}, " for i in range(len(attributes)))
    try:
        response = get_table().update_item(
            Key=key,
            UpdateExpression=f"SET {sets}#version = :next",
            ConditionExpression="attribute_exists(PK) AND #version = :expected",
            ExpressionAttributeNames=names | {"#version": "version"},
            ExpressionAttributeValues=values
            | {":expected": expected_version, ":next": expected_version + 1},
            ReturnValues="ALL_NEW",
            ReturnValuesOnConditionCheckFailure="ALL_OLD",
        )
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") != _CONDITION_FAILED:
            raise _translate(exc) from None
        raise (VersionConflict() if "Item" in exc.response else DesignNotFound()) from None
    except BotoCoreError as exc:
        raise _translate(exc) from None
    return _record(response["Attributes"])


def delete(user_id: str, design_id: str) -> None:
    """Idempotente: apagar o que não existe na partição não é erro (nem toca outra partição)."""
    key = _key(user_id, design_id)
    with _store_errors():
        get_table().delete_item(Key=key)


def count(user_id: str) -> int:
    return sum(int(page["Count"]) for page in _pages(user_id, Select="COUNT"))


def list_summaries(user_id: str) -> list[dict[str, Any]]:
    """Metadados de todos os designs do usuário, sem `doc` e sem ordem garantida."""
    pages = _pages(
        user_id,
        ProjectionExpression=_SUMMARY_PROJECTION,
        ExpressionAttributeNames=_SUMMARY_NAMES,
    )
    return [_record(item) for page in pages for item in page["Items"]]
