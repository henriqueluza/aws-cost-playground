"""Composition root da API e handler da Lambda."""

from fastapi import FastAPI
from mangum import Mangum

from app.config import get_settings


def create_app() -> FastAPI:
    get_settings()  # sem variável obrigatória, a função não sobe
    return FastAPI(title="AWS Cost Playground API", docs_url=None, redoc_url=None, openapi_url=None)


def create_handler(app: FastAPI) -> Mangum:
    return Mangum(app, lifespan="off")


app = create_app()
handler = create_handler(app)
