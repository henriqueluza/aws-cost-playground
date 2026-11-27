"""`POST /estimates`: a ordem que sustenta o teto de gasto, a resposta, os erros e o log.

Sem rede, sem AWS e sem a Claude API: SDK e SSM simulados (`Fakes`), DynamoDB do `moto` ou o
dublê `FakeTable`. As chamadas a `prepare`, `consume` e `estimate` são registradas em `calls`.
"""

import json
import math
import re
from typing import Any

import anthropic
import pytest
from botocore.exceptions import ClientError
from fastapi import FastAPI

from app.config import get_settings
from app.estimates import service
from app.estimates.claude_client import get_claude_client
from app.logs import configure_logging
from app.quotas import service as quotas
from app.routing import MAX_BODY_BYTES
from tests.conftest import invoke, make_event
from tests.test_claude_client import GOOD, REQUEST, Fakes, reply, status_error
from tests.test_estimate_revalidation import BODY
from tests.test_quotas import FakeTable

SUB = "8f14e45f-ceea-467f-a0e6-1a2b3c4d5e6f"
OTHER = "0b1c2d3e-0000-4000-8000-aaaaaaaaaaaa"
SENTINEL = "SENTINELA-7f3a"
PROBLEM = "application/problem+json"
LAMBDA = {"id": "blk_fn", "type": "aws.lambda", "attributes": {}}
TOO_LARGE = BODY | {"blocks": [LAMBDA | {"id": f"blk_{i}"} for i in range(100)], "edges": []}
THIRD_PARTY = ("corpo-da-anthropic", "req_vazou", "texto da AWS", "acp-test", "anthropic")


class Harness:
    """App com o cliente e a quota espionados: `calls` guarda a ordem real das chamadas."""

    def __init__(self, app: FastAPI, monkeypatch: pytest.MonkeyPatch) -> None:
        self.app, self.calls, self.fakes = app, [], Fakes()
        self._monkeypatch = monkeypatch
        consume = service.consume

        def spy(sub: str) -> Any:
            self.calls.append(f"consume:{sub}")
            return consume(sub)

        monkeypatch.setattr(service, "consume", spy)
        self.use(self.fakes)

    def use(self, fakes: Fakes, *, enabled: bool = True) -> None:
        self.fakes = fakes
        client = fakes.client(enabled=enabled)
        for name in ("prepare", "estimate"):
            self._spy(client, name)
        self.app.dependency_overrides[get_claude_client] = lambda: client

    def _spy(self, client: Any, name: str) -> None:
        method = getattr(client, name)

        def spy(argument: Any) -> Any:
            self.calls.append(name)
            return method(argument)

        self._monkeypatch.setattr(client, name, spy)

    def post(self, body: Any = BODY, *, raw: str | None = None, **claims: str) -> Any:
        payload = raw if raw is not None else json.dumps(body)
        headers = {"content-type": "application/json", "x-user-id": OTHER}
        event = make_event(
            "/estimates", method="POST", claims={"sub": SUB} | claims, headers=headers, body=payload
        )
        return invoke(self.app, event)

    def paid_calls(self) -> int:
        return len(self.fakes.calls)


@pytest.fixture
def harness(app: FastAPI, table: Any, monkeypatch: pytest.MonkeyPatch) -> Harness:
    monkeypatch.setenv("LLM_ENABLED", "true")
    get_settings.cache_clear()
    return Harness(app, monkeypatch)


def remaining(sub: str = SUB) -> int:
    return quotas.read(sub).remaining


def events(capsys: pytest.CaptureFixture[str]) -> list[dict[str, Any]]:
    lines = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    return [line for line in lines if line["logger"] == "app.estimate"]


def assert_client_schema(body: dict[str, Any]) -> None:
    """Campo a campo, o `estimateResponseSchema` de `web/src/shared/lib/api/ports.ts`.

    O zod do cliente descarta chave desconhecida; a única chave a mais aceita aqui é `source`.
    """
    assert set(body) == {"blocks", "edges", "quota"}
    for items, prefix, limit in ((body["blocks"], "blk", 100), (body["edges"], "edg", 400)):
        assert isinstance(items, list) and len(items) <= limit
        for item in items:
            assert {"id", "values"} <= set(item) <= {"id", "values", "source"}
            assert re.fullmatch(rf"{prefix}_[A-Za-z0-9_-]{{1,60}}", item["id"])
            assert item["source"] in ("llm", "default")
            assert len(item["values"]) <= 32
            for key, value in item["values"].items():
                assert re.fullmatch(r"[a-z][A-Za-z0-9]{0,39}", key)
                assert type(value) in (int, float) and math.isfinite(value)
                assert 0 <= value <= 1e12
    quota = body["quota"]
    assert set(quota) == {"limit", "remaining", "resetsAt"}
    assert type(quota["limit"]) is int and type(quota["remaining"]) is int
    assert quota["limit"] >= 0 and quota["remaining"] >= 0
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z", quota["resetsAt"])


# --- ordem e resposta ------------------------------------------------------------------------


def test_sucesso_segue_a_ordem_e_devolve_so_ids_numeros_e_quota(harness: Harness) -> None:
    status, headers, body = harness.post()
    assert (status, headers["content-type"]) == (200, "application/json")
    assert harness.calls == ["prepare", f"consume:{SUB}", "estimate"]
    assert harness.paid_calls() == 1  # uma chamada à LLM por requisição, sem nova tentativa
    assert_client_schema(body)
    assert [block["id"] for block in body["blocks"]] == [block["id"] for block in BODY["blocks"]]
    assert [edge["id"] for edge in body["edges"]] == [edge["id"] for edge in BODY["edges"]]
    assert body["blocks"][0]["values"]["requestsPerMonth"] == 5000
    assert [block["source"] for block in body["blocks"]] == ["llm", "default", "default", "default"]
    assert body["quota"] == {"limit": 20, "remaining": 19, "resetsAt": body["quota"]["resetsAt"]}
    assert remaining() == 19


def test_texto_devolvido_pela_llm_nao_chega_a_resposta(harness: Harness) -> None:
    hostile = {
        "blocks": [
            {"n": 0, "id": SENTINEL, "note": SENTINEL, "values": GOOD["blocks"][0]["values"]},
            {"n": 1, "values": [{"key": SENTINEL, "value": 1}, {"key": "x", "value": SENTINEL}]},
        ],
        "edges": [],
        "comment": SENTINEL,
    }
    harness.use(Fakes(hostile))
    status, _, body = harness.post()
    assert status == 200
    assert_client_schema(body)
    assert SENTINEL not in json.dumps(body)


def test_diagrama_sem_nada_a_estimar_consome_quota_e_nao_chama_a_llm(harness: Harness) -> None:
    status, _, body = harness.post(BODY | {"blocks": [], "edges": []})
    assert (status, body["blocks"], body["edges"]) == (200, [], [])
    assert harness.calls == ["prepare", f"consume:{SUB}", "estimate"]
    assert (harness.paid_calls(), body["quota"]["remaining"]) == (0, 19)


def test_identidade_vem_so_do_sub_do_jwt(harness: Harness) -> None:
    forged = BODY | {"sub": OTHER, "userId": OTHER, "user_id": OTHER}
    assert harness.post(forged)[0] == 200
    assert harness.calls[1] == f"consume:{SUB}"
    assert (remaining(SUB), remaining(OTHER)) == (19, 20)


# --- o que não consome quota -----------------------------------------------------------------


@pytest.mark.parametrize(
    ("request_", "expected"),
    [
        ({"claims": None}, 401),
        ({"raw": "{" + " " * MAX_BODY_BYTES}, 413),
        ({"raw": "{"}, 422),
        ({"body": {}}, 422),
        ({"body": BODY | {"description": "d" * 2001}}, 422),
        ({"body": BODY | {"blocks": [LAMBDA] * 101}}, 422),
        ({"body": BODY | {"region": "eu-west-9"}}, 422),
    ],
    ids=["sem-jwt", "corpo-grande", "json-quebrado", "vazio", "desc-2001", "101-blocos", "regiao"],
)
def test_entrada_invalida_nao_consome_quota_nem_chama_a_llm(
    harness: Harness, request_: dict[str, Any], expected: int
) -> None:
    if "claims" in request_:
        event = make_event("/estimates", method="POST", body=json.dumps(BODY))
        status = invoke(harness.app, event)[0]
    else:
        status = harness.post(request_.get("body"), raw=request_.get("raw"))[0]
    assert status == expected
    assert harness.calls == []  # nem `prepare`: a `ProtectedRoute` e o Pydantic vêm antes
    assert (harness.paid_calls(), harness.fakes.ssm_reads, remaining()) == (0, 0, 20)


def test_diagrama_grande_demais_responde_413_sem_consumir_quota(harness: Harness) -> None:
    status, headers, problem = harness.post(TOO_LARGE)
    assert (status, headers["content-type"]) == (413, PROBLEM)
    assert problem["detail"] == "The diagram is too large to estimate."
    assert harness.calls == ["prepare"]
    assert (harness.paid_calls(), remaining()) == (0, 20)


def test_interruptor_desligado_responde_503_sem_quota_e_sem_llm(
    harness: Harness, capsys: pytest.CaptureFixture[str]
) -> None:
    configure_logging("INFO")
    harness.use(Fakes(), enabled=False)
    status, headers, problem = harness.post()
    assert (status, headers["content-type"]) == (503, PROBLEM)
    assert "retry-after" not in headers
    assert problem == {
        "type": "about:blank",
        "title": "Service Unavailable",
        "status": 503,
        "detail": "Estimates are unavailable.",
        "requestId": "req-test-1",
    }
    assert harness.calls == ["prepare"]  # `consume` não é chamado
    assert (harness.paid_calls(), harness.fakes.ssm_reads, remaining()) == (0, 0, 20)
    (event,) = events(capsys)
    assert (event["message"], event["level"], event["result"]) == (
        "estimate rejected",
        "WARNING",
        "disabled",
    )


def test_sem_a_variavel_llm_enabled_a_rota_nasce_desligada(
    app: FastAPI, table: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Fiação real (`get_claude_client` do ambiente): sem `LLM_ENABLED`, 503 e quota intacta."""
    get_claude_client.cache_clear()
    monkeypatch.setattr(service, "consume", lambda sub: pytest.fail("quota consumida"))
    event = make_event("/estimates", method="POST", claims={"sub": SUB}, body=json.dumps(BODY))
    event["headers"]["content-type"] = "application/json"
    assert invoke(app, event)[0] == 503
    assert remaining() == 20
    get_claude_client.cache_clear()


# --- quota recusa: a LLM nunca é chamada (o teste que sustenta o teto de gasto) ---------------


@pytest.mark.parametrize("scope", ["user", "global"])
def test_quota_esgotada_responde_429_e_a_llm_nao_e_chamada(
    harness: Harness, monkeypatch: pytest.MonkeyPatch, scope: str
) -> None:
    variable = {"user": "QUOTA_USER_DAILY_LIMIT", "global": "QUOTA_GLOBAL_DAILY_LIMIT"}[scope]
    monkeypatch.setenv(variable, "1")
    get_settings.cache_clear()
    quotas.consume(SUB if scope == "user" else OTHER)  # gasta a única unidade do limite

    status, headers, problem = harness.post()
    assert (status, headers["content-type"]) == (429, PROBLEM)
    assert problem["scope"] == scope
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}T00:00:00Z", problem["resetsAt"])
    assert harness.calls == ["prepare", f"consume:{SUB}"]  # `estimate` nunca roda
    assert (harness.paid_calls(), harness.fakes.ssm_reads) == (0, 0)


ACCESS_DENIED = ClientError(
    {"Error": {"Code": "AccessDeniedException", "Message": "texto da AWS"}}, "TransactWriteItems"
)


@pytest.mark.parametrize(
    "fake",
    [
        lambda: FakeTable(transact_error=ACCESS_DENIED),  # corte do AWS Budgets (Issue #5)
        lambda: FakeTable(get=ACCESS_DENIED),  # incrementou, mas a leitura do restante falhou
        lambda: FakeTable(get={"Item": {"count": "muitos"}}),
    ],
    ids=["escrita-negada", "leitura-negada", "resposta-estranha"],
)
def test_quota_indisponivel_responde_503_e_a_llm_nao_e_chamada(
    harness: Harness, monkeypatch: pytest.MonkeyPatch, fake: Any
) -> None:
    """Falha fechada: sem consumo confirmado, nenhuma chamada paga."""
    monkeypatch.setattr(quotas, "get_table", fake)
    status, headers, problem = harness.post()
    assert (status, headers["content-type"]) == (503, PROBLEM)
    assert "detail" not in problem
    assert not any(leak in json.dumps(problem) for leak in THIRD_PARTY)
    assert harness.calls == ["prepare", f"consume:{SUB}"]
    assert (harness.paid_calls(), harness.fakes.ssm_reads) == (0, 0)


def test_resultado_da_quota_aparece_no_evento_da_estimativa(
    harness: Harness, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    configure_logging("INFO")
    monkeypatch.setenv("QUOTA_USER_DAILY_LIMIT", "1")
    get_settings.cache_clear()
    assert [harness.post()[0], harness.post()[0]] == [200, 429]
    monkeypatch.setattr(quotas, "get_table", lambda: FakeTable(transact_error=ACCESS_DENIED))
    assert harness.post()[0] == 503
    logged = [(e["message"], e["level"], e["result"]) for e in events(capsys)]
    assert logged == [
        ("estimate completed", "INFO", "ok"),
        ("estimate rejected", "WARNING", "quota_exhausted"),
        ("estimate rejected", "WARNING", "quota_unavailable"),
    ]


# --- falha da LLM depois do consumo: quota não é devolvida ------------------------------------


def api_error(cls: type[anthropic.APIStatusError], status: int) -> Any:
    return lambda: Fakes(status_error(cls, status))


@pytest.mark.parametrize(
    ("fakes", "code", "status", "retry_after", "tokens"),
    [
        (lambda: Fakes(reply(GOOD, "refusal")), "refused", 502, None, (900, 60)),
        (lambda: Fakes(reply(GOOD, "max_tokens")), "truncated", 502, None, (900, 60)),
        (lambda: Fakes(f"{SENTINEL} nao e json"), "invalid_output", 502, None, (900, 60)),
        (lambda: Fakes(anthropic.APITimeoutError(REQUEST)), "timeout", 503, "30", (0, 0)),
        (api_error(anthropic.RateLimitError, 429), "rate_limited", 503, "30", (0, 0)),
        (api_error(anthropic.InternalServerError, 529), "overloaded", 503, "30", (0, 0)),
        (api_error(anthropic.BadRequestError, 400), "unavailable", 503, None, (0, 0)),
        (lambda: Fakes(ssm_value=ACCESS_DENIED), "unavailable", 503, None, (0, 0)),
    ],
    ids=["refused", "truncated", "invalid", "timeout", "rate", "overloaded", "400", "ssm"],
)
def test_falha_da_llm_depois_do_consumo_e_logada_e_a_quota_nao_volta(
    harness: Harness,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    fakes: Any,
    code: str,
    status: int,
    retry_after: str | None,
    tokens: tuple[int, int],
) -> None:
    configure_logging("INFO")
    table = FakeTable()
    monkeypatch.setattr(quotas, "get_table", lambda: table)
    harness.use(fakes())

    got, headers, problem = harness.post()
    assert (got, headers["content-type"], headers.get("retry-after")) == (
        status,
        PROBLEM,
        retry_after,
    )
    detail = {502: "The estimate failed.", 503: "Estimates are unavailable."}[status]
    assert problem == {
        "type": "about:blank",
        "title": problem["title"],
        "status": status,
        "detail": detail,
        "requestId": "req-test-1",
    }
    assert not any(leak in json.dumps(problem) for leak in (*THIRD_PARTY, SENTINEL))
    assert harness.calls == ["prepare", f"consume:{SUB}", "estimate"]
    assert harness.paid_calls() <= 1  # nenhuma nova tentativa na rota
    # A quota fica consumida: uma única escrita (o incremento) e nenhum decremento depois.
    assert len(table.transactions) == 1
    # Pela partição, em qualquer dia: a rota usa o relógio real, e `count()` só olha o dia fixo.
    assert {pk: item["count"] for (pk, _), item in table.items.items()} == {
        f"USER#{SUB}": 1,
        "GLOBAL": 1,
    }
    (event,) = events(capsys)
    assert (event["message"], event["level"]) == ("estimate failed after quota consumed", "ERROR")
    assert (event["result"], event["input_tokens"], event["output_tokens"]) == (code, *tokens)


def test_erro_inesperado_depois_do_consumo_responde_500_e_fica_no_log(
    harness: Harness, capsys: pytest.CaptureFixture[str]
) -> None:
    configure_logging("INFO")
    harness.use(Fakes(RuntimeError(SENTINEL)))
    status, _, problem = harness.post()
    assert (status, SENTINEL in json.dumps(problem)) == (500, False)
    assert remaining() == 19
    out = capsys.readouterr().out
    assert SENTINEL not in out
    (event,) = [e for e in map(json.loads, out.splitlines()) if e["logger"] == "app.estimate"]
    assert (event["message"], event["result"]) == ("estimate failed after quota consumed", "error")


def test_o_codigo_da_rota_nao_tem_devolucao_de_quota_nem_nova_tentativa() -> None:
    """A rota só conhece `consume`: não importa nada que escreva na quota além dele."""
    names = set(vars(service))
    assert "consume" in names
    assert not names & {"read", "repository", "refund", "release", "restore", "get_table", "boto3"}


# --- log sem conteúdo -------------------------------------------------------------------------


def test_log_tem_duracao_tokens_e_resultado_e_nenhum_conteudo(
    harness: Harness, capsys: pytest.CaptureFixture[str]
) -> None:
    configure_logging("DEBUG")
    body = BODY | {
        "description": f"{SENTINEL} descricao da carga",
        "blocks": [
            {
                "id": f"blk_{SENTINEL}",
                "type": "aws.lambda",
                "label": f"{SENTINEL} rotulo",
                "attributes": {"architecture": SENTINEL},
            }
        ],
        "edges": [
            {
                "id": f"edg_{SENTINEL}",
                "source": f"blk_{SENTINEL}",
                "target": "client",
                "kind": "data",
            }
        ],
    }
    assert harness.post(body, email="ana@example.com")[0] == 200
    harness.use(Fakes(f"{SENTINEL} texto livre da LLM"))
    assert harness.post(body, email="ana@example.com")[0] == 502

    out = capsys.readouterr().out
    assert SENTINEL not in out and "ana@example.com" not in out
    done, failed = (e for e in map(json.loads, out.splitlines()) if e["logger"] == "app.estimate")
    assert set(done) == {
        *("timestamp", "level", "logger", "message", "request_id"),
        *("result", "duration_ms", "input_tokens", "output_tokens"),
        *("block_count", "edge_count", "sub"),
    }
    assert isinstance(done.pop("duration_ms"), float) and done.pop("timestamp")
    assert done == {
        "level": "INFO",
        "logger": "app.estimate",
        "message": "estimate completed",
        "request_id": "req-test-1",
        "result": "ok",
        "input_tokens": 900,
        "output_tokens": 60,
        "block_count": 1,
        "edge_count": 1,
        "sub": SUB,  # pseudônimo, como nos eventos de quota da #60
    }
    assert (failed["result"], failed["level"]) == ("invalid_output", "ERROR")
