import base64
import json
import logging
from collections.abc import Iterator
from typing import Any

import boto3
import pytest
from fastapi import FastAPI
from moto import mock_aws

from app.config import get_settings
from app.dynamo import get_table


class FakeContext:
    aws_request_id = "req-test-1"


def make_event(
    path: str = "/",
    *,
    method: str = "GET",
    claims: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
    query: str = "",
    body: str | None = None,
) -> dict[str, Any]:
    """Evento do API Gateway HTTP API (payload 2.0). `claims=None` = sem authorizer."""
    context: dict[str, Any] = {
        "requestId": "apigw-req-1",
        "http": {"method": method, "path": path, "sourceIp": "203.0.113.9", "protocol": "HTTP/1.1"},
    }
    if claims is not None:
        context["authorizer"] = {"jwt": {"claims": claims, "scopes": None}}
    return {
        "version": "2.0",
        "routeKey": "$default",
        "rawPath": path,
        "rawQueryString": query,
        "headers": {"host": "api.test", **(headers or {})},
        "requestContext": context,
        "body": body,
        "isBase64Encoded": False,
    }


def invoke(app: FastAPI, event: dict[str, Any]) -> tuple[int, dict[str, str], Any]:
    """Chama o app pelo mesmo caminho da Lambda (handler do Mangum)."""
    from app.main import create_handler

    response = create_handler(app)(event, FakeContext())
    raw = response.get("body") or ""
    if response.get("isBase64Encoded"):  # Mangum codifica application/problem+json em base64
        raw = base64.b64decode(raw).decode()
    return response["statusCode"], response["headers"], json.loads(raw) if raw else None


@pytest.fixture(autouse=True)
def env(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setenv("TABLE_NAME", "acp-test")
    monkeypatch.setenv("AWS_DEFAULT_REGION", "us-east-1")
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "testing")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "testing")
    get_settings.cache_clear()
    get_table.cache_clear()
    yield
    get_settings.cache_clear()
    get_table.cache_clear()


@pytest.fixture(autouse=True)
def restore_logging() -> Iterator[None]:
    """`configure_logging` troca os handlers do root; cada teste começa e termina igual."""
    root, app_logger = logging.getLogger(), logging.getLogger("app")
    saved = (root.handlers[:], root.level, app_logger.level)
    yield
    root.handlers[:], root.level = saved[0], saved[1]
    app_logger.setLevel(saved[2])


@pytest.fixture
def app() -> FastAPI:
    from app.main import create_app

    return create_app()


@pytest.fixture
def table() -> Iterator[Any]:
    """Tabela única num DynamoDB simulado (moto), com as chaves de `infra/modules/database`."""
    with mock_aws():
        boto3.client("dynamodb", region_name="us-east-1").create_table(
            TableName="acp-test",
            KeySchema=[
                {"AttributeName": "PK", "KeyType": "HASH"},
                {"AttributeName": "SK", "KeyType": "RANGE"},
            ],
            AttributeDefinitions=[
                {"AttributeName": "PK", "AttributeType": "S"},
                {"AttributeName": "SK", "AttributeType": "S"},
            ],
            BillingMode="PAY_PER_REQUEST",
        )
        yield get_table()
