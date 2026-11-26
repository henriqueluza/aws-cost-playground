"""Dados do usuário na tabela única: apaga a partição `USER#<sub>` inteira (designs e quotas).

Só `Query` e `BatchWriteItem`, as ações que o papel da função `api` tem para `USER#*`. Nunca
`Scan`. A quota global (`PK = GLOBAL`) não é do usuário e fica fora do alcance por construção.
"""

import time
from collections.abc import Callable
from typing import Any

from boto3.dynamodb.conditions import Key

BATCH_SIZE = 25
"""Teto do `BatchWriteItem`."""
MAX_BATCH_ATTEMPTS = 3
"""Envios de um mesmo lote enquanto houver `UnprocessedItems`."""
MAX_PASSES = 3
"""Voltas de consulta + exclusão antes de desistir com a partição ainda ocupada."""
BACKOFF_SECONDS = 0.05


class PartitionNotEmptyError(Exception):
    """Sobraram itens depois de todas as tentativas. A chamada pode ser repetida."""


class AccountRepository:
    def __init__(self, table: Any, sleep: Callable[[float], None] = time.sleep) -> None:
        self._table = table
        self._sleep = sleep

    def delete_all(self, user_id: str) -> int:
        """Apaga todos os itens de `USER#<user_id>` e devolve quantos apagou.

        Idempotente: partição vazia devolve 0. Levanta `PartitionNotEmptyError` se ainda houver
        item depois de `MAX_PASSES` voltas.
        """
        partition = f"USER#{user_id}"
        deleted = 0
        for _ in range(MAX_PASSES):
            keys = self._keys(partition)
            if not keys:
                return deleted
            for start in range(0, len(keys), BATCH_SIZE):
                deleted += self._delete_batch(keys[start : start + BATCH_SIZE])
        if self._keys(partition):
            raise PartitionNotEmptyError
        return deleted

    def _keys(self, partition: str) -> list[dict[str, str]]:
        """Chaves de todos os itens da partição (consulta paginada, leitura consistente)."""
        query: dict[str, Any] = {
            "KeyConditionExpression": Key("PK").eq(partition),
            "ProjectionExpression": "SK",
            "ConsistentRead": True,
        }
        keys: list[dict[str, str]] = []
        while True:
            page = self._table.query(**query)
            # A `PK` da chave apagada é sempre a do token, nunca um valor lido da tabela.
            keys += [{"PK": partition, "SK": item["SK"]} for item in page["Items"]]
            if "LastEvaluatedKey" not in page:
                return keys
            query["ExclusiveStartKey"] = page["LastEvaluatedKey"]

    def _delete_batch(self, keys: list[dict[str, str]]) -> int:
        """Apaga um lote, reenviando `UnprocessedItems` com espera. Devolve quantos saíram."""
        name = self._table.name
        pending: list[Any] = [{"DeleteRequest": {"Key": key}} for key in keys]
        for attempt in range(MAX_BATCH_ATTEMPTS):
            if attempt:
                self._sleep(BACKOFF_SECONDS * 2**attempt)
            response = self._table.meta.client.batch_write_item(RequestItems={name: pending})
            pending = response.get("UnprocessedItems", {}).get(name, [])
            if not pending:
                break
        return len(keys) - len(pending)
