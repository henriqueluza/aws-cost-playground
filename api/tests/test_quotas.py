import json
import re
import threading
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace
from typing import Any

import boto3
import pytest
from botocore.exceptions import ClientError, EndpointConnectionError
from fastapi import FastAPI
from moto import mock_aws
from pydantic import ValidationError

from app import auth
from app.config import (
    MAX_QUOTA_GLOBAL_DAILY_LIMIT,
    MAX_QUOTA_USER_DAILY_LIMIT,
    Settings,
    get_settings,
)
from app.dynamo import get_table
from app.logs import configure_logging
from app.quotas import service
from app.quotas.service import QuotaExhausted, QuotaUnavailable, consume, read
from tests.conftest import invoke, make_event

SUB = "8f14e45f-ceea-467f-a0e6-1a2b3c4d5e6f"
OTHER = "0b1c2d3e-0000-4000-8000-aaaaaaaaaaaa"
NOON = datetime(2026, 11, 26, 12, 0, tzinfo=UTC)
RESETS = "2026-11-27T00:00:00Z"
DAY = "QUOTA#2026-11-26"
FAILED = "ConditionalCheckFailed"
CONDITION = "attribute_not_exists(#count) OR #count < :limit"
LEAKS = ("acp-test", "USER#", "GLOBAL", "QUOTA#", "Dynamo", "Requested resource")


def settings(user: int = 20, global_: int = 300, *, enabled: bool = True) -> Settings:
    return Settings(
        table_name="acp-test",
        llm_enabled=enabled,
        quota_user_daily_limit=user,
        quota_global_daily_limit=global_,
    )


def at(moment: datetime = NOON) -> service.Clock:
    return lambda: moment


def canceled(*codes: Any) -> ClientError:
    error = {"Code": "TransactionCanceledException", "Message": "texto da AWS"}
    reasons = [{"Code": code} if isinstance(code, str) else code for code in codes]
    return ClientError({"Error": error, "CancellationReasons": reasons}, "TransactWriteItems")


class FakeTable:
    """Dublê em memória: transação atômica com condição por item e `CancellationReasons`."""

    name = "acp-test"

    def __init__(self, *, transact_error: Exception | None = None, get: Any = ...) -> None:
        self.items: dict[tuple[str, str], dict[str, int]] = {}
        self.transactions: list[list[dict[str, Any]]] = []
        self.gets = 0
        self.meta = SimpleNamespace(client=self)
        self._transact_error, self._get, self._lock = transact_error, get, threading.Lock()

    def transact_write_items(self, *, TransactItems: list[dict[str, Any]]) -> None:
        self.transactions.append(TransactItems)
        if self._transact_error:
            raise self._transact_error
        updates = [item["Update"] for item in TransactItems]
        # O dublê aplica "abaixo do limite" sem interpretar a expressão: se ela mudar, ele recusa.
        assert all(u["ConditionExpression"] == CONDITION for u in updates)
        with self._lock:  # o DynamoDB serializa a transação; o que roda fora dela é o serviço
            keys = [(u["Key"]["PK"], u["Key"]["SK"]) for u in updates]
            limits = [u["ExpressionAttributeValues"][":limit"] for u in updates]
            counts = [self.items.get(key, {}).get("count", 0) for key in keys]
            codes = [
                "None" if c < limit else FAILED for c, limit in zip(counts, limits, strict=True)
            ]
            if FAILED in codes:
                raise canceled(*codes)
            for key, update in zip(keys, updates, strict=True):
                item = self.items.setdefault(
                    key, {"ttl": update["ExpressionAttributeValues"][":ttl"]}
                )
                item["count"] = item.get("count", 0) + 1

    def get_item(self, *, Key: dict[str, str], **_: Any) -> Any:
        self.gets += 1
        if isinstance(self._get, Exception):
            raise self._get
        if self._get is not ...:
            return self._get
        item = self.items.get((Key["PK"], Key["SK"]))
        return {"Item": {"count": Decimal(item["count"])}} if item else {}

    def count(self, pk: str, sk: str = DAY) -> int:
        return self.items.get((pk, sk), {}).get("count", 0)


@pytest.fixture
def table() -> Iterator[Any]:
    """Tabela real do moto: as expressões da transação são avaliadas de verdade."""
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


def stored(table: Any, pk: str, sk: str = DAY) -> dict[str, Any] | None:
    item: dict[str, Any] | None = table.get_item(Key={"PK": pk, "SK": sk}).get("Item")
    return item


def exhausted(sub: str, config: Settings, table: Any, now: datetime = NOON) -> QuotaExhausted:
    with pytest.raises(QuotaExhausted) as info:
        consume(sub, table=table, settings=config, now=at(now))
    return info.value


# --- consumo atômico -------------------------------------------------------------------------


def test_consumo_cria_os_dois_contadores_com_ttl_de_35_dias(table: Any) -> None:
    state = consume(SUB, table=table, settings=settings(), now=at())
    assert state.model_dump(by_alias=True) == {"limit": 20, "remaining": 19, "resetsAt": RESETS}
    ttl = int(NOON.timestamp()) + 35 * 86_400
    expected = {"PK": f"USER#{SUB}", "SK": DAY, "count": 1, "ttl": ttl}
    assert stored(table, f"USER#{SUB}") == expected
    assert stored(table, "GLOBAL") == expected | {"PK": "GLOBAL"}
    # O segundo consumo soma e não empurra o `ttl` (if_not_exists).
    later = consume(SUB, table=table, settings=settings(), now=at(NOON + timedelta(hours=3)))
    assert later.remaining == 18
    assert stored(table, f"USER#{SUB}") == expected | {"count": 2}
    assert stored(table, "GLOBAL") == expected | {"PK": "GLOBAL", "count": 2}


def test_limite_do_usuario_estourado_nao_consome_o_global(table: Any) -> None:
    config = settings(user=2)
    for _ in range(2):
        consume(SUB, table=table, settings=config, now=at())
    error = exhausted(SUB, config, table)
    assert (error.status_code, error.scope, error.resets_at) == (429, "user", RESETS)
    assert stored(table, f"USER#{SUB}")["count"] == 2  # type: ignore[index]
    assert stored(table, "GLOBAL")["count"] == 2  # type: ignore[index]
    assert consume(OTHER, table=table, settings=config, now=at()).remaining == 1


def test_limite_global_estourado_nao_consome_o_do_usuario(table: Any) -> None:
    config = settings(global_=2)
    consume(SUB, table=table, settings=config, now=at())
    consume(SUB, table=table, settings=config, now=at())
    assert exhausted(OTHER, config, table).scope == "global"
    assert stored(table, f"USER#{OTHER}") is None
    assert stored(table, "GLOBAL")["count"] == 2  # type: ignore[index]


def test_com_os_dois_limites_estourados_vence_user(table: Any) -> None:
    config = settings(user=1, global_=1)
    consume(SUB, table=table, settings=config, now=at())
    assert exhausted(SUB, config, table).scope == "user"
    assert stored(table, f"USER#{SUB}")["count"] == 1  # type: ignore[index]
    assert stored(table, "GLOBAL")["count"] == 1  # type: ignore[index]


def test_transacao_unica_com_dois_updates_condicionais() -> None:
    fake = FakeTable()
    consume(SUB, table=fake, settings=settings(), now=at())
    (items,) = fake.transactions
    ttl = int(NOON.timestamp()) + service.TTL_SECONDS
    assert [set(item) for item in items] == [{"Update"}, {"Update"}]
    for item, key, limit in zip(
        items,
        ({"PK": f"USER#{SUB}", "SK": DAY}, {"PK": "GLOBAL", "SK": DAY}),
        (20, 300),
        strict=True,
    ):
        assert item["Update"] == {
            "TableName": "acp-test",
            "Key": key,
            "UpdateExpression": "SET #ttl = if_not_exists(#ttl, :ttl) ADD #count :one",
            "ConditionExpression": CONDITION,
            "ExpressionAttributeNames": {"#count": "count", "#ttl": "ttl"},
            "ExpressionAttributeValues": {":one": 1, ":limit": limit, ":ttl": ttl},
        }


@pytest.mark.parametrize(
    ("users", "per_user", "config", "allowed"),
    [(1, 60, settings(), 20), (5, 20, settings(global_=50), 50), (4, 30, settings(), 80)],
)
def test_consumos_simultaneos_nunca_passam_dos_limites(
    users: int, per_user: int, config: Settings, allowed: int
) -> None:
    fake = FakeTable()
    subs = [f"user-{n}" for n in range(users)] * per_user

    def attempt(sub: str) -> bool:
        try:
            consume(sub, table=fake, settings=config, now=at())
        except QuotaExhausted:
            return False
        return True

    with ThreadPoolExecutor(max_workers=16) as pool:
        granted = sum(pool.map(attempt, subs))
    assert granted == allowed == fake.count("GLOBAL")
    per_sub = [fake.count(f"USER#user-{n}") for n in range(users)]
    assert sum(per_sub) == allowed
    assert max(per_sub) <= config.quota_user_daily_limit


# --- janela diária em UTC --------------------------------------------------------------------


def test_o_dia_e_o_utc_do_servidor_e_a_virada_zera_a_quota(table: Any) -> None:
    config = settings(user=1)
    # 23:30 de 26/11 em UTC-3 já é 27/11 em UTC: o fuso do relógio não muda a janela.
    local = datetime(2026, 11, 26, 23, 30, tzinfo=timezone(timedelta(hours=-3)))
    state = consume(SUB, table=table, settings=config, now=at(local))
    assert state.resets_at == "2026-11-28T00:00:00Z"
    assert stored(table, f"USER#{SUB}", "QUOTA#2026-11-27")["count"] == 1  # type: ignore[index]
    last_second = datetime(2026, 11, 27, 23, 59, 59, tzinfo=UTC)
    assert exhausted(SUB, config, table, last_second).resets_at == "2026-11-28T00:00:00Z"
    midnight = datetime(2026, 11, 28, tzinfo=UTC)
    assert consume(SUB, table=table, settings=config, now=at(midnight)).resets_at == (
        "2026-11-29T00:00:00Z"
    )
    assert read(SUB, table=table, settings=config, now=at(midnight)).remaining == 0


# --- falha fechada ---------------------------------------------------------------------------


def test_llm_desligada_responde_indisponivel_sem_tocar_no_contador() -> None:
    fake = FakeTable()
    with pytest.raises(QuotaUnavailable) as info:
        consume(SUB, table=fake, settings=settings(enabled=False), now=at())
    assert info.value.status_code == 503
    assert (fake.transactions, fake.gets) == ([], 0)
    assert get_settings().llm_enabled is False  # sem a variável, o padrão é desligado


@pytest.mark.parametrize(
    "error",
    [
        ClientError({"Error": {"Code": "ThrottlingException"}}, "TransactWriteItems"),
        ClientError({"Error": {"Code": "AccessDeniedException"}}, "TransactWriteItems"),
        ClientError({}, "TransactWriteItems"),
        EndpointConnectionError(endpoint_url="https://dynamodb.invalid"),
        canceled("TransactionConflict", "None"),
        canceled(FAILED, "ThrottlingError"),
        canceled("None", "None"),
        canceled(FAILED),
        canceled(FAILED, "None", "None"),
        canceled(FAILED, None),
        canceled(),
        ClientError({"Error": {"Code": "TransactionCanceledException"}}, "TransactWriteItems"),
        ClientError(
            {"Error": {"Code": "TransactionCanceledException"}, "CancellationReasons": FAILED},
            "TransactWriteItems",
        ),
    ],
)
def test_erro_ou_resposta_duvidosa_da_transacao_nao_autoriza(error: Exception) -> None:
    fake = FakeTable(transact_error=error)
    with pytest.raises(QuotaUnavailable) as info:
        consume(SUB, table=fake, settings=settings(), now=at())
    assert (info.value.status_code, info.value.__cause__, fake.gets) == (503, None, 0)


@pytest.mark.parametrize(
    "response",
    [
        ClientError({"Error": {"Code": "InternalServerError"}}, "GetItem"),
        EndpointConnectionError(endpoint_url="https://dynamodb.invalid"),
        None,
        [],
        {"Item": None},
        {"Item": {}},
        {"Item": {"count": "3"}},
        {"Item": {"count": 3}},
        {"Item": {"count": Decimal(-1)}},
        {"Item": {"count": Decimal("1.5")}},
    ],
)
def test_leitura_com_erro_ou_resposta_inesperada_e_indisponivel(response: Any) -> None:
    for call in (read, consume):  # no consumo, a quota já foi gasta e a resposta ainda é 503
        fake = FakeTable(get=response)
        with pytest.raises(QuotaUnavailable):
            call(SUB, table=fake, settings=settings(), now=at())


@pytest.mark.parametrize("sub", ["", "a#b", "GLOBAL#x", "é", "a b", "x" * 129, f"{SUB}\n"])
def test_sub_fora_do_formato_nunca_vira_chave(sub: str) -> None:
    fake = FakeTable()
    for call in (read, consume):
        with pytest.raises(QuotaUnavailable):
            call(sub, table=fake, settings=settings(), now=at())
    assert (fake.transactions, fake.gets) == ([], 0)
    assert service.SUB_PATTERN.pattern == auth.SUB_PATTERN.pattern


def test_relogio_sem_fuso_nao_autoriza() -> None:
    fake = FakeTable()
    with pytest.raises(QuotaUnavailable):
        consume(SUB, table=fake, settings=settings(), now=at(datetime(2026, 11, 26, 12, 0)))
    assert fake.transactions == []


# --- configuração ----------------------------------------------------------------------------


def test_limites_padrao_sao_os_do_adr_e_vem_do_ambiente(monkeypatch: pytest.MonkeyPatch) -> None:
    config = get_settings()
    assert (config.quota_user_daily_limit, config.quota_global_daily_limit) == (20, 300)
    monkeypatch.setenv("QUOTA_USER_DAILY_LIMIT", "5")
    monkeypatch.setenv("QUOTA_GLOBAL_DAILY_LIMIT", "40")
    monkeypatch.setenv("LLM_ENABLED", "true")
    get_settings.cache_clear()
    config = get_settings()
    assert (config.quota_user_daily_limit, config.quota_global_daily_limit) == (5, 40)
    assert config.llm_enabled is True


@pytest.mark.parametrize(
    ("name", "value"),
    [
        ("QUOTA_USER_DAILY_LIMIT", "0"),
        ("QUOTA_USER_DAILY_LIMIT", "-1"),
        ("QUOTA_USER_DAILY_LIMIT", "1.5"),
        ("QUOTA_USER_DAILY_LIMIT", "muitos"),
        ("QUOTA_USER_DAILY_LIMIT", ""),
        ("QUOTA_USER_DAILY_LIMIT", str(MAX_QUOTA_USER_DAILY_LIMIT + 1)),
        ("QUOTA_GLOBAL_DAILY_LIMIT", "0"),
        ("QUOTA_GLOBAL_DAILY_LIMIT", "1e9"),
        ("QUOTA_GLOBAL_DAILY_LIMIT", str(MAX_QUOTA_GLOBAL_DAILY_LIMIT + 1)),
        ("LLM_ENABLED", "talvez"),
    ],
)
def test_configuracao_invalida_ou_acima_do_teto_impede_a_funcao_de_subir(
    monkeypatch: pytest.MonkeyPatch, name: str, value: str
) -> None:
    monkeypatch.setenv(name, value)
    get_settings.cache_clear()
    with pytest.raises(ValidationError):
        get_settings()
    assert (MAX_QUOTA_USER_DAILY_LIMIT, MAX_QUOTA_GLOBAL_DAILY_LIMIT) == (100, 1_000)


# --- GET /quota, 429 e logs ------------------------------------------------------------------


def quota_event(sub: str = SUB, path: str = "/quota") -> dict[str, Any]:
    return make_event(path, claims={"sub": sub, "email": "ana@example.com"})


def test_get_quota_le_sem_consumir_e_so_o_proprio_usuario(app: FastAPI, table: Any) -> None:
    """Com `LLM_ENABLED` desligado (padrão do ambiente de teste) a leitura continua respondendo."""
    today = datetime.now(UTC)
    for _ in range(3):
        consume(OTHER, table=table, settings=settings(), now=at(today))
    consume(SUB, table=table, settings=settings(), now=at(today))
    for _ in range(2):
        status, _, body = invoke(app, quota_event())
        assert status == 200
        assert set(body) == {"limit", "remaining", "resetsAt"}
        assert (body["limit"], body["remaining"]) == (20, 19)
        assert re.fullmatch(r"\d{4}-\d{2}-\d{2}T00:00:00Z", body["resetsAt"])
        assert datetime.fromisoformat(body["resetsAt"]) > today
    assert invoke(app, quota_event(OTHER))[2]["remaining"] == 17
    assert invoke(app, quota_event("sem-uso"))[2]["remaining"] == 20
    # Limite reduzido abaixo do contador: o restante nunca fica negativo.
    assert read(OTHER, table=table, settings=settings(user=2), now=at(today)).remaining == 0


@mock_aws
def test_get_quota_com_dynamodb_fora_responde_503_sem_detalhe_interno(
    app: FastAPI, capsys: pytest.CaptureFixture[str]
) -> None:
    configure_logging("INFO")
    status, headers, body = invoke(app, quota_event())  # a tabela não existe
    assert (status, headers["content-type"]) == (503, "application/problem+json")
    assert body == {
        "type": "about:blank",
        "title": "Service Unavailable",
        "status": 503,
        "requestId": "req-test-1",
    }
    out = capsys.readouterr().out
    assert '"message": "quota read failed"' in out and "ResourceNotFoundException" in out
    assert not any(leak in out for leak in (*LEAKS, SUB, "ana@example.com"))


def test_429_em_problem_details_com_scope_e_resets_at_e_log_do_evento(
    app: FastAPI, table: Any, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("LLM_ENABLED", "true")
    monkeypatch.setenv("QUOTA_USER_DAILY_LIMIT", "1")
    get_settings.cache_clear()
    configure_logging("INFO")

    def route(user_id: auth.CurrentUserId) -> int:  # como a rota de estimativa chamará
        return consume(user_id).remaining

    app.add_api_route("/consume", route)
    event = quota_event(path="/consume")
    assert invoke(app, event)[2] == 0
    status, headers, body = invoke(app, event)
    assert (status, headers["content-type"]) == (429, "application/problem+json")
    resets_at = body.pop("resetsAt")
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}T00:00:00Z", resets_at)
    assert body == {
        "type": "about:blank",
        "title": "Too Many Requests",
        "status": 429,
        "scope": "user",
        "requestId": "req-test-1",
    }
    lines = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    events = [line for line in lines if line["logger"] == "app.quota"]
    assert [(e["message"], e["level"], e["scope"], e["limit"], e["sub"]) for e in events] == [
        ("quota consumed", "INFO", "user", 1, SUB),
        ("quota exhausted", "WARNING", "user", 1, SUB),
    ]
    assert events[0]["count"] == 1 and events[0]["request_id"] == "req-test-1"
    assert not any(leak in json.dumps(lines) for leak in (*LEAKS, "ana@example.com"))
