"""Entradas e saídas das rotas de designs (espelham `web/src/shared/lib/api/ports.ts`)."""

from typing import Annotated, Self

from pydantic import AfterValidator, Field, StringConstraints, model_validator
from pydantic_core import PydanticCustomError

from app.design_document import (
    ContractModel,
    DesignDocument,
    NotNull,
    Region,
    UtcTimestamp,
)
from app.errors import TOO_LARGE_ERROR

DESIGN_ID_PATTERN = r"^[0-9A-HJKMNP-TV-Z]{26}$"
MAX_DOC_BYTES = 100_000
"""Teto do `doc` em bytes UTF-8 (ADR-0001, #277): com `MAX_DESIGNS`, partição de até 1 MB."""
MAX_VERSION = 2**53 - 1
"""Maior inteiro exato do JS (`Number.MAX_SAFE_INTEGER`). Acima disso o `web/` não representa a
versão, e um inteiro de 38 dígitos ou mais nem cabe no número do DynamoDB."""

DesignId = Annotated[str, StringConstraints(pattern=DESIGN_ID_PATTERN)]
DesignName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]


def doc_size_bytes(doc: DesignDocument) -> int:
    """Bytes UTF-8 do JSON compacto do documento, como o `sizeBytes` do ADR."""
    return len(doc.model_dump_json(by_alias=True, exclude_none=True).encode())


def _check_size(doc: DesignDocument) -> DesignDocument:
    if doc_size_bytes(doc) > MAX_DOC_BYTES:
        raise PydanticCustomError(TOO_LARGE_ERROR, "Design document too large")
    return doc


SizedDesignDocument = Annotated[DesignDocument, AfterValidator(_check_size)]


class DesignCreate(ContractModel):
    name: DesignName
    doc: SizedDesignDocument


class DesignUpdate(ContractModel):
    expected_version: Annotated[int, Field(ge=1, le=MAX_VERSION)]
    # `null` explícito é recusado (`NotNull`): o web omite a chave quando não altera o campo.
    name: Annotated[DesignName | None, NotNull] = None
    doc: Annotated[SizedDesignDocument | None, NotNull] = None

    @model_validator(mode="after")
    def _at_least_one_change(self) -> Self:
        if self.name is None and self.doc is None:
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
