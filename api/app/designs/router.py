"""Rotas de designs. Handlers ainda sem implementação: respondem 501."""

from typing import Annotated

from fastapi import APIRouter, HTTPException, Path

from app.auth import CurrentUserId
from app.designs.schemas import (
    DESIGN_ID_PATTERN,
    DesignCreate,
    DesignDuplicate,
    DesignOut,
    DesignSummaryOut,
    DesignUpdate,
)

router = APIRouter(prefix="/designs")
DesignIdPath = Annotated[str, Path(pattern=DESIGN_ID_PATTERN)]


@router.get("", response_model=list[DesignSummaryOut])
def list_designs(user_id: CurrentUserId) -> None:
    """Lista os designs do usuário (Issue #53)."""
    raise HTTPException(status_code=501)


@router.post("", status_code=201, response_model=DesignOut, response_model_exclude_none=True)
def create_design(user_id: CurrentUserId, body: DesignCreate) -> None:
    """Cria um design (Issue #53)."""
    raise HTTPException(status_code=501)


@router.get("/{design_id}", response_model=DesignOut, response_model_exclude_none=True)
def get_design(user_id: CurrentUserId, design_id: DesignIdPath) -> None:
    """Lê um design (Issue #53)."""
    raise HTTPException(status_code=501)


@router.patch("/{design_id}", response_model=DesignOut, response_model_exclude_none=True)
def update_design(user_id: CurrentUserId, design_id: DesignIdPath, body: DesignUpdate) -> None:
    """Atualiza nome e/ou documento, com trava otimista (Issue #54)."""
    raise HTTPException(status_code=501)


@router.delete("/{design_id}", status_code=204)
def delete_design(user_id: CurrentUserId, design_id: DesignIdPath) -> None:
    """Apaga um design (Issue #54)."""
    raise HTTPException(status_code=501)


@router.post(
    "/{design_id}/duplicate",
    status_code=201,
    response_model=DesignOut,
    response_model_exclude_none=True,
)
def duplicate_design(
    user_id: CurrentUserId, design_id: DesignIdPath, body: DesignDuplicate
) -> None:
    """Duplica um design com outro nome (Issue #54)."""
    raise HTTPException(status_code=501)
