"""Rotas de designs: criar, ler e listar (Issue #53); atualizar, duplicar e apagar (Issue #54)."""

from collections.abc import Callable, Coroutine
from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Path, Request, Response

from app.auth import CurrentUserId
from app.designs import service
from app.designs.errors import DesignError
from app.designs.schemas import (
    DESIGN_ID_PATTERN,
    DesignCreate,
    DesignDuplicate,
    DesignOut,
    DesignSummaryOut,
    DesignUpdate,
)
from app.routing import ProtectedRoute


class DesignRoute(ProtectedRoute):
    """Ponto único que converte `DesignError` em resposta: só o status e o detalhe fixos."""

    def get_route_handler(self) -> Callable[[Request], Coroutine[Any, Any, Response]]:
        handler = super().get_route_handler()

        async def translated(request: Request) -> Response:
            try:
                return await handler(request)
            except DesignError as exc:
                raise HTTPException(status_code=exc.status, detail=exc.detail) from None

        return translated


router = APIRouter(prefix="/designs", route_class=DesignRoute)
DesignIdPath = Annotated[str, Path(pattern=DESIGN_ID_PATTERN)]


@router.get("", response_model=list[DesignSummaryOut])
def list_designs(user_id: CurrentUserId) -> list[DesignSummaryOut]:
    """Lista os resumos dos designs do usuário, sem `doc`."""
    return service.list_designs(user_id)


@router.post("", status_code=201, response_model=DesignOut, response_model_exclude_none=True)
def create_design(user_id: CurrentUserId, body: DesignCreate) -> DesignOut:
    """Cria um design na partição do usuário; 409 no limite de designs."""
    return service.create_design(user_id, body)


@router.get("/{design_id}", response_model=DesignOut, response_model_exclude_none=True)
def get_design(user_id: CurrentUserId, design_id: DesignIdPath) -> DesignOut:
    """Lê um design do usuário; 404 se não existe na partição dele."""
    return service.get_design(user_id, design_id)


@router.patch("/{design_id}", response_model=DesignOut, response_model_exclude_none=True)
def update_design(user_id: CurrentUserId, design_id: DesignIdPath, body: DesignUpdate) -> DesignOut:
    """Atualiza nome e/ou documento (renomear é só o nome); 409 se a versão não é a atual."""
    return service.update_design(user_id, design_id, body)


@router.delete("/{design_id}", status_code=204)
def delete_design(user_id: CurrentUserId, design_id: DesignIdPath) -> None:
    """Apaga um design do usuário; idempotente (204 também quando não existe)."""
    service.delete_design(user_id, design_id)


@router.post(
    "/{design_id}/duplicate",
    status_code=201,
    response_model=DesignOut,
    response_model_exclude_none=True,
)
def duplicate_design(
    user_id: CurrentUserId, design_id: DesignIdPath, body: DesignDuplicate
) -> DesignOut:
    """Duplica um design do usuário com outro nome; 404 se não existe, 409 no limite."""
    return service.duplicate_design(user_id, design_id, body)
