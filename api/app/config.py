"""Configuração da API, lida só de variáveis de ambiente.

A função Lambda falha na inicialização se faltar variável obrigatória: `create_app()` chama
`get_settings()`, e o `ValidationError` do pydantic impede a função de subir.
"""

from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(frozen=True)

    table_name: str = Field(min_length=3, max_length=255)
    # Só a função `api` recebe o pool; sem ele, a exclusão de conta responde 503 sem apagar nada.
    user_pool_id: str | None = Field(default=None, pattern=r"^[\w-]+_[0-9a-zA-Z]+$", max_length=55)
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
