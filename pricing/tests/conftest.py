import socket

import pytest


@pytest.fixture(autouse=True)
def _no_network(monkeypatch: pytest.MonkeyPatch) -> None:
    """Nenhum teste sai para a rede: qualquer conexão de socket falha."""

    def refuse(*args: object, **kwargs: object) -> None:
        raise OSError("rede bloqueada nos testes")

    monkeypatch.setattr(socket.socket, "connect", refuse)
