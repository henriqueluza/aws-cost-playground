"""Acesso à tabela única do DynamoDB. Repositórios recebem a tabela daqui."""

from functools import lru_cache
from typing import Any


@lru_cache(maxsize=1)
def get_table() -> Any:
    """Tabela `Settings.table_name`, criada sob demanda e reutilizada entre invocações."""
    raise NotImplementedError
