"""Identidade do usuário. Único ponto do código que lê quem está chamando.

O JWT authorizer do API Gateway (HTTP API, payload 2.0) valida o token antes da Lambda e entrega
os claims no evento, que o Mangum expõe em `scope["aws.event"]`. A API nunca lê o token nem
cabeçalhos: a identidade é só o claim `sub`.
"""

from typing import Annotated

from fastapi import Depends, Request


def current_user_id(request: Request) -> str:
    """Devolve o `sub` do JWT. Sem claim válido, levanta HTTPException 401 (problem details)."""
    raise NotImplementedError


CurrentUserId = Annotated[str, Depends(current_user_id)]
