import socket

import pytest


def test_network_is_blocked() -> None:
    with pytest.raises(OSError, match="rede bloqueada"):
        socket.create_connection(("192.0.2.1", 443), timeout=1)
