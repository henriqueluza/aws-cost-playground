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
    # Só a função `api` recebe o pool; sem ele, a exclusão de conta responde 503 sem apagar nada.
    user_pool_id: str | None = Field(default=None, pattern=r"^[\w-]+_[0-9a-zA-Z]+$", max_length=55)
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"
    # Falha fechada: sem a variável, nenhuma estimativa é autorizada.
    llm_enabled: bool = False
    # O id do modelo é configuração (ADR-0001): trocar muda o custo por chamada em até 40 vezes.
    llm_model: str = Field(default="claude-haiku-5-5", pattern=r"^claude-[a-z0-9-]{1,60}$")
    # Só o NOME do parâmetro do SSM; o valor é lido em execução pelo cliente da Claude API.
    anthropic_api_key_parameter: str | None = Field(
        default=None, pattern=r"^/[A-Za-z0-9/_.-]{1,255}$"
    )
    # Padrões do ADR-0001. Mudar o valor é decisão de custo do autor; nunca vem de requisição.
    quota_user_daily_limit: int = Field(default=20, ge=1, le=MAX_QUOTA_USER_DAILY_LIMIT)
    quota_global_daily_limit: int = Field(default=300, ge=1, le=MAX_QUOTA_GLOBAL_DAILY_LIMIT)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
