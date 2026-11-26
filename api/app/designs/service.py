"""Regras de criar, ler e listar designs. O `user_id` é sempre o `sub` do JWT."""

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
    StoreFailure,
)
from app.designs.schemas import DesignCreate, DesignOut, DesignSummaryOut

MAX_DESIGNS = 50
"""Limite de designs por usuário (ADR-0001)."""
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


def create_design(user_id: str, body: DesignCreate) -> DesignOut:
    """Cria com id, versão e datas do servidor. No limite, `DesignLimitReached` sem gravar.

    Sem transação (o papel da função não tem `TransactWriteItems`), o limite vale assim: conta,
    grava com condição de não existência e conta de novo; se passou (ou se a recontagem
    falhou), apaga o que gravou e recusa. Duas criações simultâneas no limite podem ser ambas
    recusadas, nunca ambas aceitas.
    """
    if repository.count(user_id) >= MAX_DESIGNS:
        raise DesignLimitReached
    raw = body.doc.model_dump_json(by_alias=True, exclude_none=True)
    timestamp = _now()
    attributes: dict[str, Any] = {
        "name": body.name,
        "region": body.doc.region,
        "schemaVersion": body.doc.schema_version,
        "blockCount": len(body.doc.blocks),
        "sizeBytes": len(raw.encode()),
        "createdAt": timestamp,
        "updatedAt": timestamp,
        "version": 1,
    }
    for _ in range(_ID_ATTEMPTS):
        design_id = new_design_id()
        if repository.put_new(user_id, design_id, attributes | {"doc": raw}):
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
    return DesignOut.model_validate(attributes | {"id": design_id, "doc": body.doc})


def get_design(user_id: str, design_id: str) -> DesignOut:
    record = repository.get(user_id, design_id)
    if record is None:
        raise DesignNotFound
    try:
        doc = DesignDocument.model_validate(json.loads(record["doc"]))
        return DesignOut.model_validate(record | {"doc": doc})
    except ValueError, TypeError, KeyError:
        raise _corrupted() from None


def list_designs(user_id: str) -> list[DesignSummaryOut]:
    """Resumos do mais recente para o mais antigo (`updatedAt`, depois `id`), até `MAX_DESIGNS`."""
    try:
        summaries = [DesignSummaryOut.model_validate(r) for r in repository.list_summaries(user_id)]
    except ValueError:
        raise _corrupted() from None
    summaries.sort(key=lambda s: (s.updated_at, s.id), reverse=True)
    return summaries[:MAX_DESIGNS]
