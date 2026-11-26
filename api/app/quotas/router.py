"""Rota da quota: leitura sem consumo."""

from fastapi import APIRouter

from app.auth import CurrentUserId
from app.quotas import service
from app.quotas.schemas import QuotaOut
from app.routing import ProtectedRoute

router = APIRouter(route_class=ProtectedRoute)


@router.get("/quota", response_model=QuotaOut)
def get_quota(user_id: CurrentUserId) -> QuotaOut:
    """Lê a quota do usuário sem consumir."""
    return service.read(user_id)
