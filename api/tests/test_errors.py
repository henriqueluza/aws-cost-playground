import json
import logging
from typing import Annotated

import pytest
from fastapi import FastAPI, HTTPException
from pydantic import AfterValidator, BaseModel
from pydantic_core import PydanticCustomError

from app.errors import TOO_LARGE_ERROR
from app.logs import configure_logging
from tests.conftest import invoke, make_event

LEAK = "leak@example.com"
PROBLEM = "application/problem+json"


class Item(BaseModel):
    qty: int


def _too_large(value: str) -> str:
    if len(value) > 3:
        raise PydanticCustomError(TOO_LARGE_ERROR, "too large")
    return value


class Doc(BaseModel):
    text: Annotated[str, AfterValidator(_too_large)]
    qty: int


@pytest.fixture
def probe(app: FastAPI) -> FastAPI:
    @app.get("/forbidden")
    def forbidden() -> None:
        raise HTTPException(403, detail="x", headers={"X-Probe": "1"})

    @app.post("/items")
    def items(item: Item) -> None: ...

    @app.post("/docs")
    def docs(doc: Doc) -> None: ...

    @app.get("/boom")
    def boom() -> None:
        raise ValueError("literal-leak@example.com") from KeyError(LEAK)

    return app


def test_problem_json_shape_and_headers(probe: FastAPI) -> None:
    status, headers, body = invoke(probe, make_event("/nope"))
    assert (status, headers["content-type"], body["title"]) == (404, PROBLEM, "Not Found")
    assert (body["type"], body["status"], body["requestId"]) == ("about:blank", 404, "req-test-1")
    status, headers, body = invoke(probe, make_event("/forbidden"))
    assert (status, body["detail"], headers["x-probe"]) == (403, "x", "1")


def test_validation_error_never_echoes_input(probe: FastAPI) -> None:
    event = make_event("/items", method="POST", body=f'{{"qty": "{LEAK}"}}')
    event["headers"]["content-type"] = "application/json"
    status, headers, body = invoke(probe, event)
    assert (status, headers["content-type"], body["errors"][0]["loc"]) == (
        422,
        PROBLEM,
        ["body", "qty"],
    )
    assert LEAK not in str(body)


@pytest.mark.parametrize(
    ("payload", "status"),
    [('{"text": "toolong", "qty": "x"}', 413), ('{"text": "ok", "qty": "x"}', 422)],
)
def test_doc_too_large_is_413_without_errors(probe: FastAPI, payload: str, status: int) -> None:
    event = make_event("/docs", method="POST", body=payload)
    event["headers"]["content-type"] = "application/json"
    code, headers, body = invoke(probe, event)
    assert (code, headers["content-type"], body["status"]) == (status, PROBLEM, status)
    assert ("errors" in body) is (status == 422)
    assert "toolong" not in str(body)


def test_unhandled_error_is_500_and_logs_no_message(
    probe: FastAPI, capsys: pytest.CaptureFixture[str]
) -> None:
    configure_logging("DEBUG")  # o stdout capturado recebe as linhas JSON de verdade
    logging.getLogger("botocore.endpoint").debug("authorization: leak")  # biblioteca não loga DEBUG
    status, headers, body = invoke(probe, make_event("/boom"))
    out = capsys.readouterr().out
    assert (status, headers["content-type"], "detail" in body) == (500, PROBLEM, False)
    assert "leak" not in str(body) and "leak" not in out  # nem a mensagem nem o texto da linha
    [line] = [x for x in map(json.loads, out.splitlines()) if x["logger"] == "app.error"]
    assert (line["level"], line["error_type"], line["request_id"]) == (
        "ERROR",
        "ValueError",
        "req-test-1",
    )
    assert "in boom" in line["stack"]
