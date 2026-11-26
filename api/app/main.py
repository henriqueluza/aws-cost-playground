"""Composition root da API e handler da Lambda."""

from fastapi import FastAPI
from mangum import Mangum

from app.config import get_settings
from app.errors import install_error_handlers
from app.logs import RequestLogMiddleware, configure_logging


def create_app() -> FastAPI:
    settings = get_settings()  # sem variável obrigatória, a função não sobe
    configure_logging(settings.log_level)
    app = FastAPI(title="AWS Cost Playground API", docs_url=None, redoc_url=None, openapi_url=None)
    install_error_handlers(app)
    return app


def create_handler(app: FastAPI) -> Mangum:
    return Mangum(RequestLogMiddleware(app), lifespan="off")


app = create_app()
handler = create_handler(app)
