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
    # Proxy da LLM (#61). Sem `LLM_ENABLED=true` e sem o nome do parâmetro, nada é chamado.
    llm_enabled: bool = False
    llm_model: str = Field(default="claude-haiku-5-5", pattern=r"^claude-[a-z0-9-]{1,60}$")
    anthropic_api_key_parameter: str | None = Field(
        default=None, pattern=r"^/[A-Za-z0-9/_.-]{1,255}$"
    )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
