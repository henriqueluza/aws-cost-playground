"""Configuração da API, lida só de variáveis de ambiente.

A função Lambda falha na inicialização se faltar variável obrigatória: `create_app()` chama
`get_settings()`, e o `ValidationError` do pydantic impede a função de subir.
"""

from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

MAX_QUOTA_USER_DAILY_LIMIT = 100
MAX_QUOTA_GLOBAL_DAILY_LIMIT = 1_000
"""Tetos das quotas no código: um erro de configuração não libera gasto sem limite com a LLM."""


class Settings(BaseSettings):
    model_config = SettingsConfigDict(frozen=True)

    table_name: str = Field(min_length=3, max_length=255)
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"
    # Falha fechada: sem a variável, nenhuma estimativa é autorizada.
    llm_enabled: bool = False
    # Padrões do ADR-0001. Mudar o valor é decisão de custo do autor; nunca vem de requisição.
    quota_user_daily_limit: int = Field(default=20, ge=1, le=MAX_QUOTA_USER_DAILY_LIMIT)
    quota_global_daily_limit: int = Field(default=300, ge=1, le=MAX_QUOTA_GLOBAL_DAILY_LIMIT)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
