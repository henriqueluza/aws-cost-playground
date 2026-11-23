from pathlib import Path

import pytest
from fastapi import FastAPI
from mangum import Mangum

from tests.conftest import invoke, make_event


def test_handler_e_create_handler_sao_mangum(app: FastAPI) -> None:
    from app.main import create_handler, handler

    assert isinstance(handler, Mangum)
    assert isinstance(create_handler(app), Mangum)


@pytest.mark.parametrize("path", ["/docs", "/redoc", "/openapi.json"])
def test_documentacao_automatica_desligada(app: FastAPI, path: str) -> None:
    status, _, _ = invoke(app, make_event(path))
    assert status == 404


@pytest.mark.parametrize("name", ["designs", "estimates", "quotas", "account"])
def test_pacotes_de_dominio_so_tem_init_vazio(name: str) -> None:
    import app as root

    files = [f for f in (Path(root.__file__).parent / name).iterdir() if f.name != "__pycache__"]
    assert [f.name for f in files] == ["__init__.py"]
    assert files[0].read_text() == ""
