"""Atualizar, renomear, duplicar e apagar designs (Issue #54), contra o DynamoDB simulado (moto).

Os casos espelham o fake do cliente (`web/src/shared/lib/api/inMemoryApi.ts`): `update` com
`version-conflict` sem gravar, `duplicate` com `not-found` antes de `design-limit` e `remove`
idempotente.
"""

import copy
import re
from typing import Any

import pytest
from fastapi import FastAPI

from app.designs import repository
from app.designs.schemas import DESIGN_ID_PATTERN, MAX_DOC_BYTES
from tests.test_design_document import ADR, js_size
from tests.test_designs import (
    MISSING,
    NOT_FOUND,
    USER_A,
    USER_B,
    call,
    create,
    seed,
    stored,
)
from tests.test_routes import doc_of_size

CONFLICT = {
    "type": "about:blank",
    "title": "Conflict",
    "status": 409,
    "detail": "Version conflict",
    "requestId": "req-test-1",
}


@pytest.fixture(autouse=True)
def _dynamo(table: Any) -> None:
    """Todo teste deste arquivo roda com a tabela simulada criada e vazia."""


def edited_doc() -> dict[str, Any]:
    doc = copy.deepcopy(ADR)
    doc["region"] = "sa-east-1"
    doc["blocks"] = doc["blocks"][:1]
    doc["edges"] = []
    return doc


def operations(table: Any) -> list[str]:
    """Ações do DynamoDB chamadas a partir daqui, na ordem."""
    used: list[str] = []
    events = table.meta.client.meta.events
    events.register("before-call.dynamodb", lambda model, **_: used.append(model.name))
    return used


def test_atualizar_doc_avanca_a_versao_e_rederiva_os_metadados(app: FastAPI) -> None:
    design = create(app)
    doc = edited_doc()
    status, updated = call(
        app, "PATCH", f"/designs/{design['id']}", {"expectedVersion": 1, "doc": doc}
    )
    assert status == 200
    assert (updated["id"], updated["name"], updated["version"]) == (design["id"], "Loja", 2)
    assert (updated["region"], updated["blockCount"]) == ("sa-east-1", 1)
    assert updated["sizeBytes"] == js_size(doc)
    assert updated["doc"] == doc
    assert updated["createdAt"] == design["createdAt"]
    assert updated["updatedAt"] >= design["updatedAt"]
    assert call(app, "GET", f"/designs/{design['id']}") == (200, updated)


def test_renomear_troca_so_o_nome(app: FastAPI) -> None:
    design = create(app)
    body = {"expectedVersion": 1, "name": "  Loja nova  "}
    status, renamed = call(app, "PATCH", f"/designs/{design['id']}", body)
    assert status == 200
    assert (renamed["name"], renamed["version"]) == ("Loja nova", 2)
    assert renamed["doc"] == design["doc"] == ADR
    assert {k: renamed[k] for k in ("region", "blockCount", "sizeBytes", "createdAt")} == {
        k: design[k] for k in ("region", "blockCount", "sizeBytes", "createdAt")
    }


def test_versao_desatualizada_e_409_sem_gravar(app: FastAPI, table: Any) -> None:
    design = create(app)
    path = f"/designs/{design['id']}"
    assert call(app, "PATCH", path, {"expectedVersion": 1, "name": "aba 1"})[0] == 200
    before = stored(table)
    # A segunda aba ainda tem a versão 1; a versão de amanhã também não passa.
    for expected in (1, 3):
        body = {"expectedVersion": expected, "name": "aba 2", "doc": edited_doc()}
        assert call(app, "PATCH", path, body) == (409, CONFLICT)
    assert stored(table) == before
    assert call(app, "GET", path)[1]["name"] == "aba 1"


def test_atualizar_e_uma_escrita_condicional_sem_ler_antes(app: FastAPI, table: Any) -> None:
    design = create(app)
    path = f"/designs/{design['id']}"
    used = operations(table)
    assert call(app, "PATCH", path, {"expectedVersion": 1, "doc": edited_doc()})[0] == 200
    assert call(app, "PATCH", path, {"expectedVersion": 1, "name": "x"})[0] == 409
    assert call(app, "PATCH", f"/designs/{MISSING}", {"expectedVersion": 1, "name": "x"})[0] == 404
    assert used == ["UpdateItem", "UpdateItem", "UpdateItem"]


def test_atualizar_doc_no_teto_grava_e_acima_e_413(app: FastAPI, table: Any) -> None:
    design = create(app)
    path = f"/designs/{design['id']}"
    status, updated = call(
        app, "PATCH", path, {"expectedVersion": 1, "doc": doc_of_size(MAX_DOC_BYTES)}
    )
    assert (status, updated["sizeBytes"]) == (200, MAX_DOC_BYTES)
    before = stored(table)
    over = {"expectedVersion": 2, "doc": doc_of_size(MAX_DOC_BYTES + 1)}
    assert call(app, "PATCH", path, over)[0] == 413
    assert stored(table) == before


def test_atualizar_design_de_outro_usuario_e_404_sem_gravar_nem_criar(
    app: FastAPI, table: Any
) -> None:
    of_a = create(app, "de A")
    before = stored(table)
    for body in (
        {"expectedVersion": 1, "name": "invasor"},
        {"expectedVersion": 1, "doc": edited_doc()},
    ):
        assert call(app, "PATCH", f"/designs/{of_a['id']}", body, sub=USER_B) == (404, NOT_FOUND)
    assert stored(table) == before  # nem o item de A mudou, nem nasceu item na partição de B
    assert call(app, "GET", "/designs", sub=USER_B) == (200, [])


def test_duplicar_cria_copia_com_outro_nome_e_versao_1(app: FastAPI) -> None:
    source = create(app)
    path = f"/designs/{source['id']}/duplicate"
    status, copy_ = call(app, "POST", path, {"name": " Cópia "})
    assert status == 201
    assert copy_["id"] != source["id"]
    assert re.fullmatch(DESIGN_ID_PATTERN, copy_["id"])
    assert (copy_["name"], copy_["version"], copy_["doc"]) == ("Cópia", 1, ADR)
    assert copy_["createdAt"] == copy_["updatedAt"] >= source["createdAt"]
    assert {k: copy_[k] for k in ("region", "blockCount", "sizeBytes")} == {
        k: source[k] for k in ("region", "blockCount", "sizeBytes")
    }
    assert call(app, "GET", f"/designs/{source['id']}") == (200, source)
    assert call(app, "GET", f"/designs/{copy_['id']}") == (200, copy_)


def test_duplicar_design_de_outro_usuario_e_404_sem_criar(app: FastAPI, table: Any) -> None:
    of_a = create(app, "de A")
    path = f"/designs/{of_a['id']}/duplicate"
    assert call(app, "POST", path, {"name": "roubado"}, sub=USER_B) == (404, NOT_FOUND)
    assert call(app, "POST", f"/designs/{MISSING}/duplicate", {"name": "x"}) == (404, NOT_FOUND)
    assert len(stored(table)) == 1
    assert call(app, "GET", "/designs", sub=USER_B) == (200, [])


def test_duplicar_respeita_o_limite_de_50(app: FastAPI, table: Any) -> None:
    (source, *_) = seed(50)
    status, problem = call(app, "POST", f"/designs/{source}/duplicate", {"name": "51"})
    assert (status, problem["detail"]) == (409, "Design limit reached")
    assert len(stored(table)) == 50
    # Como no fake: design que não existe é 404 mesmo no limite.
    assert call(app, "POST", f"/designs/{MISSING}/duplicate", {"name": "x"}) == (404, NOT_FOUND)


def test_duplicar_abaixo_do_limite_chega_a_50_e_para(app: FastAPI, table: Any) -> None:
    (source, *_) = seed(49)
    assert call(app, "POST", f"/designs/{source}/duplicate", {"name": "50"})[0] == 201
    assert call(app, "POST", f"/designs/{source}/duplicate", {"name": "51"})[0] == 409
    assert len(stored(table)) == 50


def test_limite_de_um_usuario_nao_conta_designs_de_outro(app: FastAPI) -> None:
    seed(50, sub=USER_B)
    source = create(app)
    assert call(app, "POST", f"/designs/{source['id']}/duplicate", {"name": "c"})[0] == 201


def test_apagar_e_idempotente(app: FastAPI, table: Any) -> None:
    design = create(app)
    path = f"/designs/{design['id']}"
    for _ in range(2):
        assert call(app, "DELETE", path) == (204, None)
    assert call(app, "GET", path) == (404, NOT_FOUND)
    assert call(app, "DELETE", f"/designs/{MISSING}") == (204, None)
    assert stored(table) == []


def test_apagar_design_de_outro_usuario_nao_o_remove(app: FastAPI, table: Any) -> None:
    of_a = create(app, "de A")
    assert call(app, "DELETE", f"/designs/{of_a['id']}", sub=USER_B) == (204, None)
    assert call(app, "GET", f"/designs/{of_a['id']}") == (200, of_a)
    assert len(stored(table)) == 1


def test_rotas_novas_usam_so_a_particao_do_sub(app: FastAPI, table: Any) -> None:
    """Chave de toda escrita e leitura das rotas novas: `USER#<sub do JWT>` e o id do caminho."""
    keys: list[dict[str, Any]] = []
    events = table.meta.client.meta.events
    events.register(
        "provide-client-params.dynamodb",
        lambda params, **_: keys.append(params.get("Key") or params.get("Item")),
    )
    design = create(app, sub=USER_B)
    keys.clear()
    path = f"/designs/{design['id']}"
    call(app, "PATCH", path, {"expectedVersion": 1, "name": "n"}, sub=USER_B)
    call(app, "POST", f"{path}/duplicate", {"name": "c"}, sub=USER_B)
    call(app, "DELETE", path, sub=USER_B)
    pks = {str(k["PK"]) for k in keys if k is not None}
    assert pks == {f"USER#{USER_B}"}


@pytest.mark.parametrize("attributes", [{"PK": "x"}, {"SK": "x"}, {"version": 9}, {}])
def test_repositorio_recusa_atualizar_chave_ou_versao(attributes: dict[str, Any]) -> None:
    with pytest.raises(ValueError, match="invalid update attributes"):
        repository.update(USER_A, MISSING, 1, attributes)


def test_atualizar_sem_expected_version_e_422_sem_gravar(app: FastAPI, table: Any) -> None:
    design = create(app)
    before = stored(table)
    status, problem = call(app, "PATCH", f"/designs/{design['id']}", {"name": "sem versão"})
    assert (status, problem["errors"][0]["loc"]) == (422, ["body", "expectedVersion"])
    assert stored(table) == before
