import logging

import pytest
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from tests.conftest import invoke, make_event

LEAK = "leak@example.com"


class Item(BaseModel):
    qty: int


@pytest.fixture
def probe(app: FastAPI) -> FastAPI:
    @app.get("/forbidden")
    def forbidden() -> None:
        raise HTTPException(403, detail="x", headers={"X-Probe": "1"})

    @app.post("/items")
    def items(item: Item) -> None: ...

    @app.get("/boom")
    def boom() -> None:
        raise ValueError(LEAK)

    return app


def test_problem_json_shape_and_headers(probe: FastAPI) -> None:
    status, _, body = invoke(probe, make_event("/nope"))
    assert (status, body["type"], body["title"]) == (404, "about:blank", "Not Found")
    assert (body["status"], body["requestId"]) == (404, "req-test-1")
    status, headers, body = invoke(probe, make_event("/forbidden"))
    assert (status, body["detail"], headers["x-probe"]) == (403, "x", "1")


def test_validation_error_never_echoes_input(probe: FastAPI) -> None:
    event = make_event("/items", method="POST", body=f'{{"qty": "{LEAK}"}}')
    event["headers"]["content-type"] = "application/json"
    status, _, body = invoke(probe, event)
    assert (status, body["errors"][0]["loc"]) == (422, ["body", "qty"])
    assert LEAK not in str(body)


def test_unhandled_error_is_500_and_logs_no_message(
    probe: FastAPI, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.DEBUG):
        status, _, body = invoke(probe, make_event("/boom"))
    assert (status, "detail" in body) == (500, False)
    [record] = [r for r in caplog.records if r.name == "app.error"]
    assert record.error_type == "ValueError"  # type: ignore[attr-defined]
    assert LEAK not in caplog.text
