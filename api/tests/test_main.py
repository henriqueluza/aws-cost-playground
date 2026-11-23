import importlib

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
def test_pacotes_de_dominio_existem(name: str) -> None:
    importlib.import_module(f"app.{name}")
