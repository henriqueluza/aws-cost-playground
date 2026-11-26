"""Entradas e saídas das rotas de designs (espelham `web/src/shared/lib/api/ports.ts`)."""

from typing import Annotated, Self

from pydantic import AfterValidator, Field, StringConstraints, model_validator
from pydantic_core import PydanticCustomError

from app.design_document import (
    ContractModel,
    DesignDocument,
    Region,
    UtcTimestamp,
    doc_size_bytes,
)
from app.errors import TOO_LARGE_ERROR

DESIGN_ID_PATTERN = r"^[0-9A-HJKMNP-TV-Z]{26}$"
MAX_DOC_BYTES = 350_000
"""Teto do documento (ADR-0001): o item do DynamoDB aceita 400 KB."""

DesignId = Annotated[str, StringConstraints(pattern=DESIGN_ID_PATTERN)]
DesignName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]


def _check_size(doc: DesignDocument) -> DesignDocument:
    if doc_size_bytes(doc) > MAX_DOC_BYTES:
        raise PydanticCustomError(TOO_LARGE_ERROR, "Design document too large")
    return doc


SizedDesignDocument = Annotated[DesignDocument, AfterValidator(_check_size)]


class DesignCreate(ContractModel):
    name: DesignName
    doc: SizedDesignDocument


class DesignUpdate(ContractModel):
    expected_version: Annotated[int, Field(ge=1)]
    name: DesignName | None = None
    doc: SizedDesignDocument | None = None

    @model_validator(mode="after")
    def _at_least_one_change(self) -> Self:
        # `null` explícito é recusado: o web omite a chave quando não altera o campo.
        for field in ("name", "doc"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} must not be null")
        if not self.model_fields_set & {"name", "doc"}:
            raise ValueError("at least one of name and doc is required")
        return self


class DesignDuplicate(ContractModel):
    name: DesignName


class DesignSummaryOut(ContractModel):
    id: DesignId
    name: DesignName
    region: Region
    schema_version: Annotated[int, Field(ge=1)]
    block_count: Annotated[int, Field(ge=0)]
    size_bytes: Annotated[int, Field(ge=0)]
    created_at: UtcTimestamp
    updated_at: UtcTimestamp
    version: Annotated[int, Field(ge=1)]


class DesignOut(DesignSummaryOut):
    doc: DesignDocument
