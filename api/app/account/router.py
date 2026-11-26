"""Rota da conta. Sem corpo, query nem parâmetro de caminho: o alvo é sempre quem chama."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from app.account.service import (
    AccountDeletionIncompleteError,
    AccountService,
    get_account_service,
)
from app.auth import CurrentUserId, CurrentUsername
from app.routing import ProtectedRoute

router = APIRouter(route_class=ProtectedRoute)


@router.delete("/me", status_code=204)
def delete_account(
    user_id: CurrentUserId,
    username: CurrentUsername,
    service: Annotated[AccountService, Depends(get_account_service)],
) -> None:
    """Apaga os designs e as quotas do usuário e depois o usuário no Cognito."""
    try:
        service.delete(user_id, username)
    except AccountDeletionIncompleteError:
        # Mensagem fixa: sem texto da AWS, tabela, pool, chave nem identidade.
        raise HTTPException(
            status_code=503,
            detail="Account deletion incomplete, retry",
            headers={"Retry-After": "5"},
        ) from None
