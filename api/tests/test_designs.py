"""Criar, ler e listar designs pelo caminho da Lambda, contra o DynamoDB simulado (moto).

Os casos espelham o fake do cliente (`web/src/shared/lib/api/inMemoryApi.ts`): mesma precedência
de erros (too-large antes de design-limit), mesma ordenação e mesmos campos derivados.
"""

import json
import re
from decimal import Decimal
from typing import Any

import pytest
from botocore.exceptions import ClientError, EndpointConnectionError, ParamValidationError
from fastapi import FastAPI

from app.designs import repository, service
from app.designs.errors import StoreFailure, StoreUnavailable
from app.designs.schemas import DESIGN_ID_PATTERN, MAX_DOC_BYTES
from app.logs import configure_logging
from tests.conftest import invoke, make_event
from tests.test_design_document import ADR, js_size
from tests.test_routes import doc_of_size, make_doc

USER_A = "8f14e45f-ceea-467f-a0e6-1a2b3c4d5e6f"
USER_B = "0a1b2c3d-0000-4111-8222-333344445555"
MISSING = "01JD0000000000000000000000"
ISO_MS = re.compile(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z")
META = {"name", "region", "schemaVersion", "blockCount", "sizeBytes"} | {
    "createdAt",
    "updatedAt",
    "version",
}
PUT_NEW = repository.put_new  # o original, para semear enquanto um teste o substitui
NOT_FOUND = {"type": "about:blank", "title": "Not Found", "status": 404, "requestId": "req-test-1"}


@pytest.fixture(autouse=True)
def _dynamo(table: Any) -> None:
    """Todo teste deste arquivo roda com a tabela simulada criada e vazia."""


def call(app: FastAPI, method: str, path: str, body: Any = None, *, sub: str = USER_A):  # type: ignore[no-untyped-def]
    headers = {"content-type": "application/json"} if body is not None else {}
    payload = None if body is None else json.dumps(body)
    event = make_event(path, method=method, claims={"sub": sub}, headers=headers, body=payload)
    status, _, parsed = invoke(app, event)
    return status, parsed


def create(app: FastAPI, name: str = "Loja", doc: Any = None, *, sub: str = USER_A) -> Any:
    status, design = call(app, "POST", "/designs", {"name": name, "doc": doc or ADR}, sub=sub)
    assert status == 201
    return design


def seed(count: int, *, sub: str = USER_A, **changes: Any) -> list[str]:
    """Grava `count` designs válidos direto no repositório (sem passar pelo limite)."""
    stamp = "2026-11-01T00:00:00.000Z"
    attributes = {"name": "s", "region": "us-east-1", "schemaVersion": 1, "blockCount": 0}
    attributes |= {"sizeBytes": 1, "createdAt": stamp, "updatedAt": stamp, "version": 1}
    attributes |= {"doc": json.dumps(make_doc())} | changes
    ids = [service.new_design_id() for _ in range(count)]
    assert all(PUT_NEW(sub, design_id, attributes) for design_id in ids)
    return ids


def stored(table: Any) -> list[dict[str, Any]]:
    return list(table.scan()["Items"])  # só no teste: a API nunca usa Scan


def test_criar_grava_o_item_do_adr_na_particao_do_sub(app: FastAPI, table: Any) -> None:
    design = create(app, "  Loja  ")
    assert re.fullmatch(DESIGN_ID_PATTERN, design["id"])
    assert design["name"] == "Loja"
    assert (design["region"], design["schemaVersion"]) == ("us-east-1", 1)
    assert (design["blockCount"], design["sizeBytes"]) == (len(ADR["blocks"]), js_size(ADR))
    assert design["version"] == 1
    assert design["createdAt"] == design["updatedAt"]
    assert ISO_MS.fullmatch(design["createdAt"])
    assert design["doc"] == ADR

    (item,) = stored(table)
    assert (item["PK"], item["SK"]) == (f"USER#{USER_A}", f"DESIGN#{design['id']}")
    assert set(item) == {"PK", "SK", "doc"} | META
    assert json.loads(item["doc"]) == ADR
    assert {key: item[key] for key in META} == {key: design[key] for key in META}


def test_ids_sao_ulids_distintos_do_servidor() -> None:
    ids = {service.new_design_id() for _ in range(200)}
    assert len(ids) == 200
    assert all(re.fullmatch(DESIGN_ID_PATTERN, design_id) for design_id in ids)
    assert len({design_id[:8] for design_id in ids}) == 1  # prefixo de tempo, resto aleatório


def test_corpo_cabecalho_e_query_nao_escolhem_particao_nem_id(app: FastAPI, table: Any) -> None:
    forged = {"name": "n", "doc": ADR, "id": MISSING, "sub": USER_B, "userId": USER_B}
    forged |= {"PK": f"USER#{USER_B}", "version": 9, "createdAt": "2020-01-01T00:00:00Z"}
    event = make_event(
        "/designs",
        method="POST",
        claims={"sub": USER_A, "custom:sub": USER_B},
        headers={"content-type": "application/json", "x-user-id": USER_B},
        query=f"sub={USER_B}&userId={USER_B}",
        body=json.dumps(forged),
    )
    status, _, design = invoke(app, event)
    assert (status, design["version"]) == (201, 1)
    assert design["id"] != MISSING
    assert [item["PK"] for item in stored(table)] == [f"USER#{USER_A}"]


def test_ler_devolve_o_que_foi_criado_e_404_sem_existir(app: FastAPI) -> None:
    design = create(app)
    assert call(app, "GET", f"/designs/{design['id']}") == (200, design)
    assert call(app, "GET", f"/designs/{MISSING}") == (404, NOT_FOUND)


def test_acesso_cruzado_e_404_igual_a_inexistente(app: FastAPI) -> None:
    of_a = create(app, "de A")
    assert call(app, "GET", f"/designs/{of_a['id']}", sub=USER_B) == (404, NOT_FOUND)
    assert call(app, "GET", "/designs", sub=USER_B) == (200, [])

    of_b = create(app, "de B", sub=USER_B)
    assert [d["id"] for d in call(app, "GET", "/designs", sub=USER_B)[1]] == [of_b["id"]]
    assert [d["id"] for d in call(app, "GET", "/designs")[1]] == [of_a["id"]]
    assert call(app, "GET", f"/designs/{of_b['id']}") == (404, NOT_FOUND)


def test_listar_devolve_resumos_sem_doc_em_ordem_de_atualizacao(app: FastAPI) -> None:
    old, tie_low, tie_high, new = sorted(seed(4))
    for design_id, updated in ((old, "2026-11-02"), (new, "2026-11-09")):
        record = repository.get(USER_A, design_id)
        assert record is not None
        record.pop("id")
        repository.delete(USER_A, design_id)
        repository.put_new(USER_A, design_id, record | {"updatedAt": f"{updated}T10:00:00.000Z"})
    for design_id in (tie_low, tie_high):  # empate em `updatedAt`: desempata por id decrescente
        record = repository.get(USER_A, design_id)
        assert record is not None
        record.pop("id")
        repository.delete(USER_A, design_id)
        repository.put_new(USER_A, design_id, record | {"updatedAt": "2026-11-05T10:00:00.000Z"})

    status, listed = call(app, "GET", "/designs")
    assert status == 200
    assert [d["id"] for d in listed] == [new, tie_high, tie_low, old]
    assert all(set(d) == {"id"} | META for d in listed)


def test_listagem_e_contagem_seguem_a_paginacao_e_projetam_sem_doc(
    app: FastAPI, table: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    ids = seed(5)
    calls: list[dict[str, Any]] = []
    query = table.query

    def paged(**kwargs: Any) -> Any:
        calls.append(kwargs)
        return query(Limit=2, **kwargs)  # força `LastEvaluatedKey` como o corte de 1 MB

    monkeypatch.setattr(table, "query", paged)
    assert repository.count(USER_A) == 5
    assert len(calls) == 3
    assert [c.get("Select") for c in calls] == ["COUNT"] * 3
    assert "ExclusiveStartKey" in calls[1]

    calls.clear()
    status, listed = call(app, "GET", "/designs")
    assert (status, sorted(d["id"] for d in listed)) == (200, sorted(ids))
    assert len(calls) == 3
    assert all("doc" not in c["ProjectionExpression"].split(", ") for c in calls)
    assert all(c["ConsistentRead"] for c in calls)


def test_listagem_nunca_passa_de_50(app: FastAPI) -> None:
    seed(service.MAX_DESIGNS + 1)  # estado que a API não produz; a resposta segue o contrato
    assert len(call(app, "GET", "/designs")[1]) == service.MAX_DESIGNS


def test_limite_de_50_responde_409_sem_gravar(app: FastAPI, table: Any) -> None:
    seed(service.MAX_DESIGNS - 1)
    seed(3, sub=USER_B)  # designs de outro usuário não contam
    create(app)
    status, problem = call(app, "POST", "/designs", {"name": "n", "doc": ADR})
    assert (status, problem["detail"]) == (409, "Design limit reached")
    assert len(stored(table)) == service.MAX_DESIGNS + 3
    assert call(app, "POST", "/designs", {"name": "n", "doc": ADR}, sub=USER_B)[0] == 201


def test_doc_grande_demais_tem_precedencia_sobre_o_limite(app: FastAPI) -> None:
    seed(service.MAX_DESIGNS)
    over = {"name": "n", "doc": doc_of_size(MAX_DOC_BYTES + 1)}
    assert call(app, "POST", "/designs", over)[0] == 413  # como o fake: too-large antes


def test_criacoes_simultaneas_nao_passam_do_limite(
    app: FastAPI, table: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Outra criação entra entre a contagem e a gravação: a recontagem desfaz esta."""
    seed(service.MAX_DESIGNS - 1)

    def racing(user_id: str, design_id: str, attributes: dict[str, Any]) -> bool:
        seed(1)
        return PUT_NEW(user_id, design_id, attributes)

    monkeypatch.setattr(repository, "put_new", racing)
    status, problem = call(app, "POST", "/designs", {"name": "perdedor", "doc": ADR})
    assert (status, problem["detail"]) == (409, "Design limit reached")
    items = stored(table)
    assert len(items) == service.MAX_DESIGNS
    assert all(item["name"] != "perdedor" for item in items)


def test_id_repetido_nao_sobrescreve_e_gera_outro(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    first = create(app, "primeiro")
    fresh = service.new_design_id()
    ids = iter([first["id"], fresh])
    monkeypatch.setattr(service, "new_design_id", lambda: next(ids))
    assert create(app, "segundo")["id"] == fresh
    assert call(app, "GET", f"/designs/{first['id']}")[1]["name"] == "primeiro"

    monkeypatch.setattr(service, "new_design_id", lambda: first["id"])
    status, problem = call(app, "POST", "/designs", {"name": "terceiro", "doc": ADR})
    assert (status, "detail" in problem) == (500, False)
    assert call(app, "GET", f"/designs/{first['id']}")[1]["name"] == "primeiro"


@pytest.mark.parametrize(
    "changes",
    [
        {"name": ""},
        {"version": 0},
        {"sizeBytes": "12"},
        {"blockCount": Decimal("1.5")},
        {"updatedAt": "ontem"},
        {"doc": '{"segredo-do-item": '},
        {"doc": json.dumps({"blocks": "segredo-do-item"})},
        {"doc": 7},
    ],
    ids=[
        "nome",
        "versao",
        "tamanho-texto",
        "fracao",
        "data",
        "json-cortado",
        "doc-invalido",
        "tipo",
    ],
)
def test_item_corrompido_vira_500_sem_detalhe(
    app: FastAPI, capsys: pytest.CaptureFixture[str], changes: dict[str, Any]
) -> None:
    configure_logging("INFO")
    (design_id,) = seed(1, **changes)
    paths = [f"/designs/{design_id}"] + ([] if "doc" in changes else ["/designs"])
    for path in paths:
        status, problem = call(app, "GET", path)
        assert status == 500
        assert problem == {
            "type": "about:blank",
            "title": "Internal Server Error",
            "status": 500,
            "requestId": "req-test-1",
        }
    out = capsys.readouterr().out
    assert out.count('"error_type": "CorruptedItem"') == len(paths)
    assert "segredo-do-item" not in out


def test_item_sem_doc_e_500(app: FastAPI, table: Any) -> None:
    (design_id,) = seed(1)
    table.put_item(Item={"PK": f"USER#{USER_A}", "SK": f"DESIGN#{design_id}", "name": "só nome"})
    assert call(app, "GET", f"/designs/{design_id}")[0] == 500
    assert call(app, "GET", "/designs")[0] == 500


AWS_TEXT = "User arn:aws:sts::123456789012:assumed-role/acp-api is not authorized on table/acp-test"


@pytest.mark.parametrize(
    ("error", "status", "logged"),
    [
        (
            ClientError({"Error": {"Code": "ThrottlingException", "Message": AWS_TEXT}}, "Query"),
            503,
            "ThrottlingException",
        ),
        (
            ClientError(
                {"Error": {"Code": "ProvisionedThroughputExceededException", "Message": AWS_TEXT}},
                "Query",
            ),
            503,
            "ProvisionedThroughputExceededException",
        ),
        (
            ClientError({"Error": {"Code": "AccessDeniedException", "Message": AWS_TEXT}}, "Query"),
            500,
            "AccessDeniedException",
        ),
        (ClientError({"Error": {"Code": AWS_TEXT, "Message": AWS_TEXT}}, "Query"), 500, "Unknown"),
        (EndpointConnectionError(endpoint_url="https://dynamodb.acp-test"), 503, "EndpointConn"),
        (ParamValidationError(report=AWS_TEXT), 500, "ParamValidationError"),
    ],
    ids=["throttle", "capacidade", "acesso-negado", "codigo-estranho", "rede", "parametro"],
)
@pytest.mark.parametrize(
    "operation", ["query", "get_item", "put_item", "update_item", "delete_item"]
)
def test_falha_do_dynamodb_vira_problema_de_mensagem_fixa(  # type: ignore[no-untyped-def]
    app, table, monkeypatch, capsys, operation, error, status, logged
) -> None:
    configure_logging("INFO")
    (design_id,) = seed(1)

    def failing(**_: Any) -> Any:
        raise error

    monkeypatch.setattr(table, operation, failing)
    body = {"name": "nome-secreto", "doc": make_doc("descricao-secreta")}
    method, path, sent = {
        "query": ("GET", "/designs", None),
        "get_item": ("GET", f"/designs/{design_id}", None),
        "put_item": ("POST", "/designs", body),
        "update_item": ("PATCH", f"/designs/{design_id}", {"expectedVersion": 1, **body}),
        "delete_item": ("DELETE", f"/designs/{design_id}", None),
    }[operation]
    got, problem = call(app, method, path, sent)
    title = "Service Unavailable" if status == 503 else "Internal Server Error"
    assert got == status
    assert problem == {
        "type": "about:blank",
        "title": title,
        "status": status,
        "requestId": "req-test-1",
    }
    lines = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    (failure,) = [line for line in lines if line["logger"] == "app.designs"]
    assert failure["request_id"] == "req-test-1"
    assert failure["error_type"].startswith(logged)
    leaks = ("arn:aws", "acp-test", "nome-secreto", "descricao-secreta", USER_A, design_id)
    assert not any(leak in json.dumps(lines) for leak in leaks)


def test_falha_ao_desfazer_a_criacao_excedente_e_erro_tratado(
    app: FastAPI, table: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    seed(service.MAX_DESIGNS - 1)
    monkeypatch.setattr(repository, "put_new", lambda *_: bool(seed(2)))
    error = ClientError({"Error": {"Code": "InternalServerError"}}, "DeleteItem")

    def failing(**_: Any) -> Any:
        raise error

    monkeypatch.setattr(table, "delete_item", failing)
    assert call(app, "POST", "/designs", {"name": "n", "doc": ADR})[0] == 503


def test_recontagem_que_falha_desfaz_a_criacao(
    app: FastAPI, table: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Sem confirmar o limite, o design não fica: o cliente nem recebeu o id."""
    counts = iter([0])

    def flaky(_: str) -> int:
        return next(counts, None) or _raise(StoreUnavailable())

    monkeypatch.setattr(repository, "count", flaky)
    assert call(app, "POST", "/designs", {"name": "n", "doc": ADR})[0] == 503
    assert stored(table) == []


def _raise(error: Exception) -> int:
    raise error


@pytest.mark.parametrize("sub", ["", "a#b", "USER#x", "a b", "x" * 129])
def test_repositorio_recusa_sub_fora_do_formato(sub: str) -> None:
    for attempt in (
        lambda: repository.get(sub, MISSING),
        lambda: repository.count(sub),
        lambda: repository.list_summaries(sub),
        lambda: repository.put_new(sub, MISSING, {}),
        lambda: repository.delete(sub, MISSING),
    ):
        with pytest.raises(ValueError, match="invalid user id"):
            attempt()


@pytest.mark.parametrize("design_id", ["", "x", f"{MISSING}#", MISSING.lower()])
def test_repositorio_recusa_id_fora_do_formato(design_id: str) -> None:
    with pytest.raises(ValueError, match="invalid design id"):
        repository.get(USER_A, design_id)


def test_so_as_acoes_concedidas_ao_papel_da_funcao(app: FastAPI, table: Any) -> None:
    """`infra/modules/functions/iam.tf`: sem Scan nem TransactWriteItems."""
    used: set[str] = set()
    events = table.meta.client.meta.events
    events.register("before-call.dynamodb", lambda model, **_: used.add(model.name))
    design = create(app)
    call(app, "GET", f"/designs/{design['id']}")
    call(app, "GET", "/designs")
    call(app, "PATCH", f"/designs/{design['id']}", {"expectedVersion": 1, "name": "n"})
    call(app, "POST", f"/designs/{design['id']}/duplicate", {"name": "c"})
    call(app, "DELETE", f"/designs/{design['id']}")
    assert used == {"Query", "PutItem", "GetItem", "UpdateItem", "DeleteItem"}


def test_store_failure_e_500_por_padrao() -> None:
    assert (StoreFailure.status, StoreFailure.detail) == (500, None)
