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
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
