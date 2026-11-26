"""Documento do design (ADR-0001, "Modelo de dados"), equivalente ao schema zod do `web/`.

Fonte da verdade: `web/src/shared/lib/design/designDocument.ts`. Os exemplos de
`contracts/examples/design/` são validados pelos dois lados; uma divergência quebra um dos testes.
Leitura tolerante: chave desconhecida é descartada, não recusada (rollback entre builds).
"""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from pydantic.alias_generators import to_camel

Region = Literal["us-east-1", "sa-east-1"]
EdgeKind = Literal["data", "runs-on", "logs"]
UsageSource = Literal["llm", "default"]
REGIONS: tuple[Region, ...] = ("us-east-1", "sa-east-1")
CLIENT_NODE_ID = "client"
"""Nó fixo, sem preço, que representa a internet. É o destino das arestas de egress."""

# Limites do documento: `MAX_BLOCKS` e `MAX_DESCRIPTION_LENGTH` vêm do ADR-0001; os outros, da #98.
MAX_BLOCKS = 100
MAX_EDGES = 400
MAX_DESCRIPTION_LENGTH = 2000
MAX_LABEL_LENGTH = 80
MAX_USAGE_VALUE = 1e12
MAX_FIELDS_PER_RECORD = 32
MAX_ATTRIBUTE_STRING_LENGTH = 64


class ContractModel(BaseModel):
    """Base dos modelos de contrato: tipos estritos (como o zod), JSON em camelCase, imutável."""

    model_config = ConfigDict(
        strict=True,
        extra="ignore",
        frozen=True,
        alias_generator=to_camel,
        validate_by_name=True,
        validate_by_alias=True,
    )


# Regex só com classes ASCII explícitas (`[0-9]`, nunca `\d`).
BlockId = Annotated[str, StringConstraints(pattern=r"^blk_[A-Za-z0-9_-]{1,60}$")]
EdgeId = Annotated[str, StringConstraints(pattern=r"^edg_[A-Za-z0-9_-]{1,60}$")]
BlockTypeName = Annotated[str, StringConstraints(pattern=r"^aws\.[a-z0-9-]{1,40}$")]
"""Genérico de propósito: os tipos aceitos são definidos em `contracts/blocks.json`."""
FieldKey = Annotated[str, StringConstraints(pattern=r"^[a-z][A-Za-z0-9]{0,39}$")]
"""Chave camelCase de atributo e de uso, fora dos nomes de `Object.prototype`."""
UtcTimestamp = Annotated[str, StringConstraints(pattern=r"^\d{4}-\d{2}-\d{2}T.*Z$")]
"""ISO 8601 em UTC (`Z`), como `z.iso.datetime()`."""
Description = Annotated[str, StringConstraints(max_length=MAX_DESCRIPTION_LENGTH)]
Label = Annotated[str, StringConstraints(max_length=MAX_LABEL_LENGTH)]
UsageNumber = Annotated[int | float, Field(ge=0, le=MAX_USAGE_VALUE)]
UsageValues = Annotated[dict[FieldKey, UsageNumber], Field(max_length=MAX_FIELDS_PER_RECORD)]
"""Números de uso finitos, de 0 a `MAX_USAGE_VALUE`. Também é o formato de `overrides`."""
AttributeValue = (
    Annotated[str, StringConstraints(max_length=MAX_ATTRIBUTE_STRING_LENGTH)] | int | float | bool
)
Attributes = Annotated[dict[FieldKey, AttributeValue], Field(max_length=MAX_FIELDS_PER_RECORD)]


class Usage(ContractModel):
    source: UsageSource
    estimated_at: UtcTimestamp | None = None
    values: UsageValues


class Block(ContractModel):
    id: BlockId
    type: BlockTypeName
    label: Label
    attributes: Attributes
    usage: Usage
    overrides: UsageValues


class Edge(ContractModel):
    id: EdgeId
    source: BlockId
    target: BlockId | Literal["client"]
    kind: EdgeKind
    usage: Usage
    overrides: UsageValues


class Workload(ContractModel):
    description: Description


class DesignDocument(ContractModel):
    """O JSON que o anônimo baixa e o logado salva. Regras de grafo no validador do modelo."""

    schema_version: Literal[1]
    region: Region
    workload: Workload
    blocks: Annotated[list[Block], Field(max_length=MAX_BLOCKS)]
    edges: Annotated[list[Edge], Field(max_length=MAX_EDGES)]
    scenarios: Annotated[list[object], Field(max_length=0)]


def doc_size_bytes(doc: DesignDocument) -> int:
    """Bytes UTF-8 do JSON compacto do documento, como o `sizeBytes` do ADR."""
    return len(doc.model_dump_json(by_alias=True, exclude_none=True).encode())
