"""Identidade do usuário. Único ponto do código que lê quem está chamando.

O JWT authorizer do API Gateway (HTTP API, payload 2.0) valida o token antes da Lambda e entrega
os claims no evento, que o Mangum expõe em `scope["aws.event"]`. A API nunca lê o token nem
cabeçalhos: a identidade é só o claim `sub`.
"""

import re
from typing import Annotated, Any

from fastapi import Depends, HTTPException, Request

_CLAIM_PATH = ("requestContext", "authorizer", "jwt", "claims", "sub")
# `sub` do Cognito é UUID; recusar `#` protege a chave `USER#<sub>` do DynamoDB.
_SUB_PATTERN = re.compile(r"[A-Za-z0-9-]{1,128}")


def current_user_id(request: Request) -> str:
    """Devolve o `sub` do JWT. Sem claim válido, levanta HTTPException 401."""
    node: Any = request.scope.get("aws.event")
    for key in _CLAIM_PATH:
        node = node.get(key) if isinstance(node, dict) else None
    if isinstance(node, str) and _SUB_PATTERN.fullmatch(node):
        return node
    raise HTTPException(
        status_code=401,
        detail="Missing or invalid identity",
        headers={"WWW-Authenticate": "Bearer"},
    )


CurrentUserId = Annotated[str, Depends(current_user_id)]
