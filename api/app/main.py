"""Composition root da API e handler da Lambda."""

from fastapi import FastAPI
from mangum import Mangum

from app.account.router import router as account_router
from app.config import get_settings
from app.designs.router import router as designs_router
from app.errors import install_error_handlers
from app.estimates.router import router as estimates_router
from app.logs import RequestLogMiddleware, configure_logging
from app.quotas.router import router as quotas_router


def create_app() -> FastAPI:
    settings = get_settings()  # sem variável obrigatória, a função não sobe
    configure_logging(settings.log_level)
    app = FastAPI(title="AWS Cost Playground API", docs_url=None, redoc_url=None, openapi_url=None)
    install_error_handlers(app)
    for router in (designs_router, estimates_router, quotas_router, account_router):
        app.include_router(router)
    return app


def create_handler(app: FastAPI) -> Mangum:
    return Mangum(RequestLogMiddleware(app), lifespan="off")


app = create_app()
handler = create_handler(app)
