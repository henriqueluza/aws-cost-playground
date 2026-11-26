"""Identidade do usuário. Único ponto do código que lê quem está chamando.

O JWT authorizer do API Gateway (HTTP API, payload 2.0) valida o token antes da Lambda e entrega
os claims no evento, que o Mangum expõe em `scope["aws.event"]`. A API nunca lê o token nem
cabeçalhos: a identidade é só o claim `sub`. O claim `username` do access token é o `Username` do
usuário no User Pool e serve só para a exclusão de conta (`AdminDeleteUser`).
"""

import re
from typing import Annotated, Any

from fastapi import Depends, HTTPException, Request

_CLAIMS_PATH = ("requestContext", "authorizer", "jwt", "claims")
# `sub` do Cognito é UUID; recusar `#` protege a chave `USER#<sub>` do DynamoDB.
SUB_PATTERN = re.compile(r"[A-Za-z0-9-]{1,128}")
# `Username` do pool: com e-mail como atributo de login, o Cognito gera um UUID.
_USERNAME_PATTERN = re.compile(r"[A-Za-z0-9_.-]{1,128}")


def _claim(request: Request, name: str, pattern: re.Pattern[str]) -> str:
    """Devolve o claim validado pelo authorizer. Ausente ou fora do formato: HTTPException 401."""
    node: Any = request.scope.get("aws.event")
    for key in (*_CLAIMS_PATH, name):
        node = node.get(key) if isinstance(node, dict) else None
    if isinstance(node, str) and pattern.fullmatch(node):
        return node
    raise HTTPException(
        status_code=401,
        detail="Missing or invalid identity",
        headers={"WWW-Authenticate": "Bearer"},
    )


def current_user_id(request: Request) -> str:
    """Devolve o `sub` do JWT. Sem claim válido, levanta HTTPException 401."""
    return _claim(request, "sub", SUB_PATTERN)


def current_username(request: Request) -> str:
    """Devolve o `username` do JWT (o `Username` no User Pool). Sem claim válido, 401."""
    return _claim(request, "username", _USERNAME_PATTERN)


CurrentUserId = Annotated[str, Depends(current_user_id)]
CurrentUsername = Annotated[str, Depends(current_username)]
