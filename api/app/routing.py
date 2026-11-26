"""Rota protegida: identidade e teto do corpo conferidos antes de o FastAPI ler o corpo."""

from collections.abc import Callable, Coroutine
from typing import Any

from fastapi import HTTPException, Request, Response
from fastapi.routing import APIRoute

from app.auth import current_user_id

MAX_BODY_BYTES = 1_048_576
"""Teto do corpo cru (1 MiB): cabe o `doc` de 350.000 bytes com folga; acima disso, 413."""


class ProtectedRoute(APIRoute):
    """Responde 401 sem `sub` e 413 com corpo acima do teto, antes de qualquer validação.

    O FastAPI lê e decodifica o corpo antes de resolver as dependências; sem esta classe, um
    corpo malformado ou enorme seria processado (e responderia 422) para quem não se autenticou.
    """

    def get_route_handler(self) -> Callable[[Request], Coroutine[Any, Any, Response]]:
        handler = super().get_route_handler()

        async def guarded(request: Request) -> Response:
            current_user_id(request)
            if len(await request.body()) > MAX_BODY_BYTES:
                raise HTTPException(status_code=413)
            return await handler(request)

        return guarded
