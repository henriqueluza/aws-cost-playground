"""Rota da estimativa de uso. Handler ainda sem implementação: responde 501."""

from fastapi import APIRouter, HTTPException

from app.auth import CurrentUserId
from app.estimates.schemas import EstimateIn, EstimateOut
from app.routing import ProtectedRoute

router = APIRouter(route_class=ProtectedRoute)


@router.post("/estimates", response_model=EstimateOut)
def create_estimate(user_id: CurrentUserId, body: EstimateIn) -> None:
    """Estima o uso dos blocos e consome quota (Issue #62)."""
    raise HTTPException(status_code=501)
