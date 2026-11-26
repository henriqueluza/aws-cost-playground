"""Rota da quota. Handler ainda sem implementação: responde 501."""

from fastapi import APIRouter, HTTPException

from app.auth import CurrentUserId
from app.quotas.schemas import QuotaOut

router = APIRouter()


@router.get("/quota", response_model=QuotaOut)
def get_quota(user_id: CurrentUserId) -> None:
    """Lê a quota sem consumir (Issue #60)."""
    raise HTTPException(status_code=501)
