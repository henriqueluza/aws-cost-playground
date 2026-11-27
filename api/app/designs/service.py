"""Regras de designs: criar, ler, listar, atualizar, duplicar e apagar.

O `user_id` é sempre o `sub` do JWT.
"""

import json
import logging
import secrets
import time
from datetime import UTC, datetime
from typing import Any

from app.design_document import DesignDocument
from app.designs import repository
from app.designs.errors import (
    CorruptedDesign,
    DesignError,
    DesignLimitReached,
    DesignNotFound,
    DesignTooLarge,
    StoreFailure,
)
from app.designs.schemas import (
    MAX_DOC_BYTES,
    DesignCreate,
    DesignDuplicate,
    DesignOut,
    DesignSummaryOut,
    DesignUpdate,
    doc_size_bytes,
)

MAX_DESIGNS = 10
"""Limite de designs por usuário (ADR-0001, #277): com `MAX_DOC_BYTES`, partição de até 1 MB."""
_ID_ATTEMPTS = 2
_CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
_logger = logging.getLogger("app.designs")


def new_design_id() -> str:
    """ULID: 48 bits de milissegundos e 80 bits do CSPRNG do sistema, em base32 de Crockford."""
    value = (time.time_ns() // 1_000_000) << 80 | secrets.randbits(80)
    return "".join(_CROCKFORD[(value >> shift) & 31] for shift in range(125, -1, -5))


def _now() -> str:
    """UTC com milissegundos e `Z`, como o `toISOString` do JS: ordena como texto."""
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _corrupted() -> CorruptedDesign:
    # Sem o conteúdo nem o erro de validação, que ecoaria o item.
    _logger.error("stored design failed validation", extra={"error_type": "CorruptedItem"})
    return CorruptedDesign()


def _doc_attributes(doc: DesignDocument) -> dict[str, Any]:
    """`doc` em JSON compacto e os metadados que derivam dele (ADR-0001)."""
    raw = doc.model_dump_json(by_alias=True, exclude_none=True)
    return {
        "region": doc.region,
        "schemaVersion": doc.schema_version,
        "blockCount": len(doc.blocks),
        "sizeBytes": len(raw.encode()),
        "doc": raw,
    }


def _to_out(record: dict[str, Any]) -> DesignOut:
    """Revalida o item gravado: o que sai do banco não é confiável."""
    try:
        doc = DesignDocument.model_validate(json.loads(record["doc"]))
        return DesignOut.model_validate(record | {"doc": doc})
    except ValueError, TypeError, KeyError:
        raise _corrupted() from None


def _insert(user_id: str, name: str, doc: DesignDocument) -> DesignOut:
    """Grava um design novo com id, versão e datas do servidor, dentro do limite de designs.

    Sem transação (o papel da função não tem `TransactWriteItems`), o limite vale assim: conta,
    grava com condição de não existência e conta de novo; se passou (ou se a recontagem
    falhou), apaga o que gravou e recusa. Duas criações simultâneas no limite podem ser ambas
    recusadas, nunca ambas aceitas.
    """
    if repository.count(user_id) >= MAX_DESIGNS:
        raise DesignLimitReached
    timestamp = _now()
    attributes: dict[str, Any] = {
        "name": name,
        **_doc_attributes(doc),
        "createdAt": timestamp,
        "updatedAt": timestamp,
        "version": 1,
    }
    for _ in range(_ID_ATTEMPTS):
        design_id = new_design_id()
        if repository.put_new(user_id, design_id, attributes):
            break
    else:
        raise StoreFailure
    try:
        if repository.count(user_id) > MAX_DESIGNS:
            raise DesignLimitReached
    except DesignError:
        # Passou do limite, ou a recontagem falhou e o limite não foi confirmado: desfaz.
        repository.delete(user_id, design_id)
        raise
    return DesignOut.model_validate(attributes | {"id": design_id, "doc": doc})


def create_design(user_id: str, body: DesignCreate) -> DesignOut:
    """No limite, `DesignLimitReached` sem gravar."""
    return _insert(user_id, body.name, body.doc)


def update_design(user_id: str, design_id: str, body: DesignUpdate) -> DesignOut:
    """Troca nome e/ou documento se `expected_version` é a atual; senão `VersionConflict`.

    Renomear é atualizar só o `name`. `createdAt` fica; `updatedAt` e `version` avançam.
    """
    changes: dict[str, Any] = {"updatedAt": _now()}
    if body.name is not None:
        changes["name"] = body.name
    if body.doc is not None:
        changes |= _doc_attributes(body.doc)
    return _to_out(repository.update(user_id, design_id, body.expected_version, changes))


def duplicate_design(user_id: str, design_id: str, body: DesignDuplicate) -> DesignOut:
    """Cópia com outro nome, id novo e `version` 1; 404 antes do limite, como no fake.

    Origem gravada acima do teto atual do documento não é copiada (413): o teto vale para todo
    item novo, também o que não passa pela validação do corpo.
    """
    source = get_design(user_id, design_id)
    if doc_size_bytes(source.doc) > MAX_DOC_BYTES:
        raise DesignTooLarge
    return _insert(user_id, body.name, source.doc)


def delete_design(user_id: str, design_id: str) -> None:
    """Idempotente: apagar um design que não existe (ou de outro usuário) não é erro."""
    repository.delete(user_id, design_id)


def get_design(user_id: str, design_id: str) -> DesignOut:
    record = repository.get(user_id, design_id)
    if record is None:
        raise DesignNotFound
    return _to_out(record)


def list_designs(user_id: str) -> list[DesignSummaryOut]:
    """Resumos do mais recente para o mais antigo (`updatedAt`, depois `id`), até `MAX_DESIGNS`."""
    try:
        summaries = [DesignSummaryOut.model_validate(r) for r in repository.list_summaries(user_id)]
    except ValueError:
        raise _corrupted() from None
    summaries.sort(key=lambda s: (s.updated_at, s.id), reverse=True)
    return summaries[:MAX_DESIGNS]
