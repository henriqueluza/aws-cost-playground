"""Rota da estimativa de uso."""

from typing import Annotated

from fastapi import APIRouter, Depends

from app.auth import CurrentUserId
from app.estimates import service
from app.estimates.claude_client import ClaudeClient, get_claude_client
from app.estimates.schemas import EstimateIn, EstimateOut
from app.routing import ProtectedRoute

router = APIRouter(route_class=ProtectedRoute)


@router.post("/estimates", response_model=EstimateOut)
def create_estimate(
    user_id: CurrentUserId,
    body: EstimateIn,
    client: Annotated[ClaudeClient, Depends(get_claude_client)],
) -> EstimateOut:
    """Estima o uso dos blocos e das arestas; consome uma estimativa da quota do usuário."""
    return service.estimate_usage(user_id, body, client)
