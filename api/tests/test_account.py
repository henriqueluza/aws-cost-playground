"""Exclusão de conta (`DELETE /me`): alvo, ordem, idempotência, erros e log."""

import ast
import json
import logging
from collections.abc import Callable, Iterator
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import boto3
import pytest
from botocore.exceptions import ClientError, EndpointConnectionError
from botocore.stub import Stubber
from fastapi import FastAPI
from moto import mock_aws
from pydantic import ValidationError

from app.account import repository
from app.account.repository import AccountRepository
from app.account.service import AccountService, get_account_service, get_identity_client
from app.config import get_settings
from app.dynamo import get_table
from app.logs import configure_logging
from tests.conftest import invoke, make_event

SUB_A = "11111111-1111-4111-8111-111111111111"
SUB_B = "22222222-2222-4222-8222-222222222222"
EMAIL_B = "bia@example.com"
POOL = "us-east-1_TestPool1"
TABLE = "acp-test"
AWS_MESSAGE = "User: arn:aws:sts::123456789012:assumed-role/acp-stg-api is not authorized"
INCOMPLETE = {
    "type": "about:blank",
    "title": "Service Unavailable",
    "status": 503,
    "detail": "Account deletion incomplete, retry",
    "requestId": "req-test-1",
}


def delete_me(app: FastAPI, sub: str = SUB_A, username: str | None = None, **event: Any) -> Any:
    claims = {"sub": sub, "username": username or sub, "token_use": "access"}
    return invoke(app, make_event("/me", method="DELETE", claims=claims, **event))


def aws_error(code: str) -> ClientError:
    return ClientError({"Error": {"Code": code, "Message": AWS_MESSAGE}}, "Operation")


def item_keys(count: int) -> list[str]:
    """Designs e, a cada quatro itens, um contador de quota: os dois tipos da partição."""
    return [f"QUOTA#2026-11-{i:02d}" if i % 4 == 3 else f"DESIGN#{i:026d}" for i in range(count)]


class FakeTable:
    """Tabela em memória: só `query` paginada e `batch_write_item`. `Scan` não existe aqui."""

    name = TABLE
    page_size = 10

    def __init__(self) -> None:
        self.items: set[tuple[str, str]] = set()
        self.batches: list[list[dict[str, str]]] = []
        self.fail_batch_calls: set[int] = set()
        self.keep_unprocessed: Callable[[int], int] = lambda call: 0
        self.query_error: Exception | None = None
        self.meta = SimpleNamespace(client=SimpleNamespace(batch_write_item=self._batch_write))

    def seed(self, sub: str, count: int) -> None:
        self.items |= {(f"USER#{sub}", sk) for sk in item_keys(count)}

    def partition(self, sub: str) -> list[str]:
        return sorted(sk for pk, sk in self.items if pk == f"USER#{sub}")

    def query(self, **kwargs: Any) -> dict[str, Any]:
        if self.query_error:
            raise self.query_error
        assert kwargs["ConsistentRead"] is True
        assert kwargs["ProjectionExpression"] == "SK"
        partition = kwargs["KeyConditionExpression"].get_expression()["values"][1]
        after = kwargs.get("ExclusiveStartKey", {}).get("SK", "")
        found = sorted(sk for pk, sk in self.items if pk == partition and sk > after)
        page: dict[str, Any] = {"Items": [{"SK": sk} for sk in found[: self.page_size]]}
        if len(found) > self.page_size:
            page["LastEvaluatedKey"] = {"PK": partition, "SK": found[self.page_size - 1]}
        return page

    def _batch_write(self, RequestItems: dict[str, list[Any]]) -> dict[str, Any]:
        assert list(RequestItems) == [TABLE]
        requests = RequestItems[TABLE]
        assert 1 <= len(requests) <= 25
        self.batches.append([r["DeleteRequest"]["Key"] for r in requests])
        call = len(self.batches)
        if call in self.fail_batch_calls:
            raise aws_error("ProvisionedThroughputExceededException")
        kept = self.keep_unprocessed(call)
        for request in requests[kept:]:
            key = request["DeleteRequest"]["Key"]
            self.items.discard((key["PK"], key["SK"]))
        return {"UnprocessedItems": {TABLE: requests[:kept]} if kept else {}}


class FakeIdentity:
    def __init__(self) -> None:
        self.calls: list[dict[str, str]] = []
        self.errors: list[Exception] = []

    def admin_delete_user(self, **kwargs: str) -> None:
        self.calls.append(kwargs)
        if self.errors:
            raise self.errors.pop(0)


class Fakes:
    def __init__(self, app: FastAPI, user_pool_id: str | None = POOL) -> None:
        self.table, self.identity, self.sleeps = FakeTable(), FakeIdentity(), list[float]()
        repo = AccountRepository(self.table, sleep=self.sleeps.append)
        service = AccountService(repo, self.identity, user_pool_id)
        app.dependency_overrides[get_account_service] = lambda: service


@pytest.fixture
def fakes(app: FastAPI) -> Fakes:
    return Fakes(app)


# --- caminho real: DynamoDB do moto e cliente do Cognito com Stubber ---------------------------
# O backend de Cognito do moto pede um pacote que não está no lock; o Stubber confere os
# parâmetros exatos do `AdminDeleteUser` sem rede.


@pytest.fixture
def aws(monkeypatch: pytest.MonkeyPatch) -> Iterator[Stubber]:
    with mock_aws():
        boto3.client("dynamodb").create_table(
            TableName=TABLE,
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
        monkeypatch.setenv("USER_POOL_ID", POOL)
        get_settings.cache_clear()
        get_identity_client.cache_clear()
        with Stubber(get_identity_client()) as stubber:
            yield stubber
        get_identity_client.cache_clear()


def stored(sub: str) -> list[str]:
    return sorted(i["SK"] for i in get_table().scan()["Items"] if i["PK"] == f"USER#{sub}")


@pytest.mark.parametrize("count", [0, 1, 26, 60])
def test_apaga_a_particao_inteira_e_o_usuario_e_so_os_de_quem_chama(
    aws: Stubber, count: int, capsys: pytest.CaptureFixture[str]
) -> None:
    from app.main import create_app

    app = create_app()
    configure_logging("INFO")
    table = get_table()
    for sub, total in ((SUB_A, count), (SUB_B, 3)):
        for sk in item_keys(total):
            table.put_item(Item={"PK": f"USER#{sub}", "SK": sk, "doc": "x" * 50})
    table.put_item(Item={"PK": "GLOBAL", "SK": "QUOTA#2026-11-26", "count": 7})
    expected = {"UserPoolId": POOL, "Username": SUB_A}
    aws.add_response("admin_delete_user", {}, expected)

    status, _, body = delete_me(app)

    assert (status, body) == (204, None)
    aws.assert_no_pending_responses()
    assert stored(SUB_A) == []
    assert stored(SUB_B) == sorted(item_keys(3))
    assert table.get_item(Key={"PK": "GLOBAL", "SK": "QUOTA#2026-11-26"})["Item"]["count"] == 7
    out = capsys.readouterr().out
    event = next(e for e in map(json.loads, out.splitlines()) if e["logger"] == "app.account")
    assert (event["message"], event["deleted_items"]) == ("account deleted", count)
    assert event["request_id"] == "req-test-1"
    assert not any(leak in out for leak in (SUB_A, SUB_B, "example.com", POOL, TABLE))
    # Repetir depois do sucesso: partição vazia e usuário inexistente contam como feitos.
    aws.add_client_error("admin_delete_user", "UserNotFoundException", expected_params=expected)
    assert delete_me(app)[0] == 204
    assert stored(SUB_B) == sorted(item_keys(3))


def test_user_pool_id_fora_do_formato_falha_na_inicializacao(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("USER_POOL_ID", "pool/../outro")
    get_settings.cache_clear()
    with pytest.raises(ValidationError):
        get_settings()


# --- alvo -----------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "event",
    [
        {"body": json.dumps({"sub": SUB_B, "userId": SUB_B, "username": SUB_B, "email": EMAIL_B})},
        {"body": "{"},
        {"query": f"sub={SUB_B}&userId={SUB_B}&username={SUB_B}&email={EMAIL_B}"},
        {"headers": {"x-user-id": SUB_B, "x-amzn-oidc-identity": SUB_B}},
    ],
    ids=["corpo", "corpo-malformado", "query", "cabecalhos"],
)
def test_nada_na_requisicao_muda_o_alvo(app: FastAPI, fakes: Fakes, event: dict[str, Any]) -> None:
    fakes.table.seed(SUB_A, 5)
    fakes.table.seed(SUB_B, 5)
    assert delete_me(app, **event)[0] == 204
    assert fakes.table.partition(SUB_A) == []
    assert fakes.table.partition(SUB_B) == sorted(item_keys(5))
    assert fakes.identity.calls == [{"UserPoolId": POOL, "Username": SUB_A}]
    assert {key["PK"] for batch in fakes.table.batches for key in batch} == {f"USER#{SUB_A}"}


@pytest.mark.parametrize("path", ["/me/" + SUB_B, "/users/" + SUB_B, "/me?sub=" + SUB_B])
def test_nao_existe_rota_com_usuario_no_caminho(app: FastAPI, fakes: Fakes, path: str) -> None:
    fakes.table.seed(SUB_B, 2)
    claims = {"sub": SUB_A, "username": SUB_A}
    status, _, _ = invoke(app, make_event(path, method="DELETE", claims=claims))
    assert status in (404, 405)
    assert (fakes.table.batches, fakes.identity.calls) == ([], [])


@pytest.mark.parametrize("username", [None, "", 7, "a#b", "ana@example.com", "a" * 129, "a b"])
def test_sem_username_valido_no_token_responde_401_sem_apagar(
    app: FastAPI, fakes: Fakes, username: Any
) -> None:
    fakes.table.seed(SUB_A, 2)
    claims = {"sub": SUB_A} if username is None else {"sub": SUB_A, "username": username}
    status, headers, body = invoke(app, make_event("/me", method="DELETE", claims=claims))
    assert (status, body["detail"]) == (401, "Missing or invalid identity")
    assert headers["www-authenticate"] == "Bearer"
    assert len(fakes.table.partition(SUB_A)) == 2
    assert (fakes.table.batches, fakes.identity.calls) == ([], [])


def test_username_do_token_e_o_que_vai_ao_cognito(app: FastAPI, fakes: Fakes) -> None:
    fakes.table.seed(SUB_A, 1)
    assert delete_me(app, SUB_A, username="user_name-1.x")[0] == 204
    assert fakes.identity.calls == [{"UserPoolId": POOL, "Username": "user_name-1.x"}]


# --- ordem, lotes e idempotência ------------------------------------------------------------


@pytest.mark.parametrize("count", [0, 1, 26, 60])
def test_lotes_de_ate_25_e_depois_o_cognito(app: FastAPI, fakes: Fakes, count: int) -> None:
    fakes.table.seed(SUB_A, count)
    assert delete_me(app)[0] == 204
    assert [len(batch) for batch in fakes.table.batches] == [25] * (count // 25) + (
        [count % 25] if count % 25 else []
    )
    assert fakes.table.partition(SUB_A) == []
    assert len(fakes.identity.calls) == 1
    assert fakes.sleeps == []


def test_falha_no_meio_dos_lotes_nao_apaga_o_usuario_e_a_repeticao_termina(
    app: FastAPI, fakes: Fakes, capsys: pytest.CaptureFixture[str]
) -> None:
    configure_logging("INFO")
    fakes.table.seed(SUB_A, 60)
    fakes.table.seed(SUB_B, 4)
    fakes.table.fail_batch_calls = {2}

    status, headers, body = delete_me(app)

    assert (status, body) == (503, INCOMPLETE)
    assert headers["retry-after"] == "5"
    assert len(fakes.table.partition(SUB_A)) == 35
    assert fakes.identity.calls == []
    out = capsys.readouterr().out
    event = next(e for e in map(json.loads, out.splitlines()) if e["logger"] == "app.account")
    assert (event["level"], event["message"]) == ("WARNING", "account deletion incomplete")
    assert (event["stage"], event["error_type"]) == (
        "data",
        "ProvisionedThroughputExceededException",
    )
    for leak in (SUB_A, TABLE, POOL, "arn:aws", "authorized", "USER#"):
        assert leak not in out
        assert leak not in json.dumps(body)

    assert delete_me(app)[0] == 204
    assert fakes.table.partition(SUB_A) == []
    assert fakes.table.partition(SUB_B) == sorted(item_keys(4))
    assert fakes.identity.calls == [{"UserPoolId": POOL, "Username": SUB_A}]


def test_unprocessed_items_passageiro_e_reenviado_com_espera(app: FastAPI, fakes: Fakes) -> None:
    fakes.table.seed(SUB_A, 26)
    fakes.table.keep_unprocessed = lambda call: 3 if call == 1 else 0
    assert delete_me(app)[0] == 204
    assert [len(batch) for batch in fakes.table.batches] == [25, 3, 1]
    assert fakes.sleeps == [repository.BACKOFF_SECONDS * 2]
    assert fakes.table.partition(SUB_A) == []
    assert len(fakes.identity.calls) == 1


def test_item_que_nunca_sai_vira_503_com_tentativas_limitadas_e_sem_cognito(
    app: FastAPI, fakes: Fakes
) -> None:
    fakes.table.seed(SUB_A, 26)
    fakes.table.keep_unprocessed = lambda call: 1
    status, _, body = delete_me(app)
    assert (status, body) == (503, INCOMPLETE)
    assert fakes.identity.calls == []
    assert len(fakes.table.batches) <= 2 * repository.MAX_BATCH_ATTEMPTS * repository.MAX_PASSES
    assert sum(fakes.sleeps) < 2  # pior caso de espera bem abaixo dos 10 s da função
    assert len(fakes.table.partition(SUB_A)) >= 1

    fakes.table.keep_unprocessed = lambda call: 0
    assert delete_me(app)[0] == 204
    assert fakes.table.partition(SUB_A) == []
    assert len(fakes.identity.calls) == 1


def test_item_criado_durante_a_exclusao_e_apagado_na_volta_seguinte(
    app: FastAPI, fakes: Fakes
) -> None:
    fakes.table.seed(SUB_A, 2)

    def recreate(call: int) -> int:
        if call == 1:
            fakes.table.items.add((f"USER#{SUB_A}", "DESIGN#criado-no-meio"))
        return 0

    fakes.table.keep_unprocessed = recreate
    assert delete_me(app)[0] == 204
    assert fakes.table.partition(SUB_A) == []


def test_erro_na_consulta_responde_503_sem_apagar(app: FastAPI, fakes: Fakes) -> None:
    fakes.table.seed(SUB_A, 3)
    fakes.table.query_error = EndpointConnectionError(endpoint_url="https://dynamodb.internal")
    status, headers, body = delete_me(app)
    assert (status, headers["content-type"], body) == (503, "application/problem+json", INCOMPLETE)
    assert (fakes.table.batches, fakes.identity.calls) == ([], [])


@pytest.mark.parametrize(
    "error",
    [aws_error("TooManyRequestsException"), EndpointConnectionError(endpoint_url="https://c")],
    ids=["erro-da-aws", "erro-de-rede"],
)
def test_falha_no_cognito_depois_dos_dados_e_a_repeticao_termina(
    app: FastAPI, fakes: Fakes, error: Exception, capsys: pytest.CaptureFixture[str]
) -> None:
    configure_logging("INFO")
    fakes.table.seed(SUB_A, 30)
    fakes.identity.errors = [error]

    status, _, body = delete_me(app)

    assert (status, body) == (503, INCOMPLETE)
    assert fakes.table.partition(SUB_A) == []
    out = capsys.readouterr().out
    assert '"stage": "identity"' in out
    assert not any(leak in out for leak in (SUB_A, POOL, "arn:aws", "https://c"))

    batches = len(fakes.table.batches)
    assert delete_me(app)[0] == 204
    assert len(fakes.table.batches) == batches  # nada mais a apagar
    assert len(fakes.identity.calls) == 2
    assert '"deleted_items": 0' in capsys.readouterr().out


def test_usuario_ja_inexistente_no_cognito_conta_como_sucesso(app: FastAPI, fakes: Fakes) -> None:
    fakes.identity.errors = [aws_error("UserNotFoundException")]
    assert delete_me(app)[0] == 204
    assert len(fakes.identity.calls) == 1


def test_sem_user_pool_configurado_responde_503_antes_de_apagar(
    app: FastAPI, capsys: pytest.CaptureFixture[str]
) -> None:
    configure_logging("INFO")
    fakes = Fakes(app, user_pool_id=None)
    fakes.table.seed(SUB_A, 2)
    status, _, body = delete_me(app)
    assert (status, body) == (503, INCOMPLETE)
    assert len(fakes.table.partition(SUB_A)) == 2
    assert (fakes.table.batches, fakes.identity.calls) == ([], [])
    assert '"stage": "config"' in capsys.readouterr().out


def test_item_que_so_sai_na_ultima_volta_ainda_termina_em_204(app: FastAPI, fakes: Fakes) -> None:
    fakes.table.seed(SUB_A, 1)
    stuck = 2 * repository.MAX_BATCH_ATTEMPTS  # as duas primeiras voltas inteiras
    fakes.table.keep_unprocessed = lambda call: 1 if call <= stuck else 0
    assert delete_me(app)[0] == 204
    assert len(fakes.table.batches) == stuck + 1
    assert fakes.table.partition(SUB_A) == []
    assert len(fakes.identity.calls) == 1


def test_registro_de_log_nao_carrega_identidade_nem_antes_do_formatador(
    app: FastAPI, fakes: Fakes, caplog: pytest.LogCaptureFixture
) -> None:
    fakes.table.seed(SUB_A, 2)
    fakes.identity.errors = [aws_error("InternalErrorException")]
    with caplog.at_level(logging.INFO, logger="app.account"):
        assert delete_me(app, username="nome-de-usuario")[0] == 503
        assert delete_me(app, username="nome-de-usuario")[0] == 204
    records = [r for r in caplog.records if r.name == "app.account"]
    assert [r.getMessage() for r in records] == ["account deletion incomplete", "account deleted"]
    for record in records:
        assert not any(leak in repr(vars(record)) for leak in (SUB_A, "nome-de-usuario", POOL))


def test_modulo_da_conta_nao_usa_scan_nem_print() -> None:
    sources = Path(repository.__file__).parent.glob("*.py")
    calls = {
        getattr(node.func, "attr", getattr(node.func, "id", ""))
        for source in sources
        for node in ast.walk(ast.parse(source.read_text(encoding="utf-8")))
        if isinstance(node, ast.Call)
    }
    assert {"query", "batch_write_item", "admin_delete_user"} <= calls
    assert not calls & {"scan", "print", "delete_item", "put_item"}
