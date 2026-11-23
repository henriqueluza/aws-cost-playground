import pytest
from pydantic import ValidationError

from app.config import get_settings


def test_create_app_sem_table_name_falha(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.main import create_app  # importa com TABLE_NAME do conftest, senão o import já falha

    monkeypatch.delenv("TABLE_NAME")
    get_settings.cache_clear()
    with pytest.raises(ValidationError):
        create_app()


def test_log_level_invalido_falha(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LOG_LEVEL", "VERBOSE")
    get_settings.cache_clear()
    with pytest.raises(ValidationError):
        get_settings()


def test_defaults() -> None:
    settings = get_settings()
    assert settings.log_level == "INFO"
    assert settings.table_name == "acp-test"
