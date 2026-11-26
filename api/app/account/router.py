"""Rota da conta. Handler ainda sem implementação: responde 501."""

from fastapi import APIRouter, HTTPException

from app.auth import CurrentUserId

router = APIRouter()


@router.delete("/me", status_code=204)
def delete_account(user_id: CurrentUserId) -> None:
    """Apaga os designs e a quota do usuário (Issue #55)."""
    raise HTTPException(status_code=501)
