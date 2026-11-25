"""Acesso à tabela única do DynamoDB. Repositórios recebem a tabela daqui."""

from functools import lru_cache
from typing import Any

import boto3
from botocore.config import Config

from app.config import get_settings

_CONFIG = Config(connect_timeout=2, read_timeout=5, retries={"max_attempts": 3, "mode": "standard"})


@lru_cache(maxsize=1)
def get_table() -> Any:
    """Tabela `Settings.table_name`, criada sob demanda e reutilizada entre invocações."""
    return boto3.resource("dynamodb", config=_CONFIG).Table(get_settings().table_name)
