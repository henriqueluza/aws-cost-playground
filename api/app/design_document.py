"""Documento do design (ADR-0001, "Modelo de dados"), equivalente ao schema zod do `web/`.

Fonte da verdade: `web/src/shared/lib/design/designDocument.ts`. Os exemplos de
`contracts/examples/design/` são validados pelos dois lados; uma divergência quebra um dos testes.
Leitura tolerante: chave desconhecida é descartada, não recusada (rollback entre builds).
Substituto UTF-16 solto é recusado (`string_unicode`) pelo validador de str com restrição
(`pattern`/`max_length`) do pydantic-core; o zod aceita. Toda str do documento tem restrição.
"""

import math
from typing import Annotated, Literal, Self

from pydantic import (
    AfterValidator,
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    StringConstraints,
    ValidationError,
    field_validator,
    model_validator,
)
from pydantic.alias_generators import to_camel
from pydantic_core import InitErrorDetails, PydanticCustomError

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

# Nomes de `Object.prototype` que casam com a regex de `FieldKey` (`__proto__` não casa).
_PROTOTYPE_KEYS = frozenset(
    {"constructor", "hasOwnProperty", "isPrototypeOf", "propertyIsEnumerable"}
    | {"toLocaleString", "toString", "valueOf"}
)
# Porte do `z.iso.datetime()` do zod 4.6 (só `Z`, segundos obrigatórios, fração livre).
_DATE = (
    r"(?:(?:[0-9]{2}[2468][048]|[0-9]{2}[13579][26]|[0-9]{2}0[48]|[02468][048]00|[13579][26]00)"
    r"-02-29|[0-9]{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12][0-9]|3[01])"
    r"|(?:0[469]|11)-(?:0[1-9]|[12][0-9]|30)|02-(?:0[1-9]|1[0-9]|2[0-8])))"
)
_TIME = r"(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\.[0-9]+)?"


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


def _own_key(key: str) -> str:
    if key in _PROTOTYPE_KEYS:
        raise PydanticCustomError("field_key_reserved", "Key is reserved by Object.prototype")
    return key


def _drop_proto(value: object) -> object:
    """O zod 4 descarta `__proto__` dos records antes de validar e de contar as chaves."""
    if isinstance(value, dict) and "__proto__" in value:
        return {key: item for key, item in value.items() if key != "__proto__"}
    return value


def _js_number(value: int | float) -> int | float:
    """Número do JS: finito em float64; inteiro vira `int` para serializar como `JSON.stringify`."""
    try:
        number = float(value)
    except OverflowError:
        number = math.inf
    if not math.isfinite(number):
        raise PydanticCustomError("finite_number", "Input should be a finite number")
    return int(number) if number.is_integer() and abs(number) < 1e21 else number


def _not_bool(value: object) -> object:
    """O `Literal[1]` aceita `True` mesmo em strict; o `z.literal(1)` recusa."""
    if isinstance(value, bool):
        raise PydanticCustomError("literal_error", "Input should be 1")
    return value


# Regex só com classes ASCII explícitas (`[0-9]`, nunca `\d`). O `$` do motor Rust não casa `\n`.
BlockId = Annotated[str, StringConstraints(pattern=r"^blk_[A-Za-z0-9_-]{1,60}$")]
EdgeId = Annotated[str, StringConstraints(pattern=r"^edg_[A-Za-z0-9_-]{1,60}$")]
BlockTypeName = Annotated[str, StringConstraints(pattern=r"^aws\.[a-z0-9-]{1,40}$")]
"""Genérico de propósito: os tipos aceitos são definidos em `contracts/blocks.json`."""
FieldKey = Annotated[
    str, StringConstraints(pattern=r"^[a-z][A-Za-z0-9]{0,39}$"), AfterValidator(_own_key)
]
"""Chave camelCase de atributo e de uso, fora dos nomes de `Object.prototype`."""
UtcTimestamp = Annotated[str, StringConstraints(pattern=rf"^{_DATE}T{_TIME}Z$")]
"""ISO 8601 em UTC (`Z`), como `z.iso.datetime()`: data válida e segundos obrigatórios."""
# `max_length` conta pontos de código, como o `.max()` do zod 4.6 (80 emojis cabem em 80).
Description = Annotated[str, StringConstraints(max_length=MAX_DESCRIPTION_LENGTH)]
Label = Annotated[str, StringConstraints(max_length=MAX_LABEL_LENGTH)]
JsNumber = Annotated[int | float, AfterValidator(_js_number)]
"""Recusa NaN, infinito e inteiro fora do float64 (o `z.number()` também)."""
UsageNumber = Annotated[JsNumber, Field(ge=0, le=MAX_USAGE_VALUE)]
UsageValues = Annotated[
    dict[FieldKey, UsageNumber],
    Field(max_length=MAX_FIELDS_PER_RECORD),
    BeforeValidator(_drop_proto),
]
"""Números de uso finitos, de 0 a `MAX_USAGE_VALUE`. Também é o formato de `overrides`."""
AttributeValue = (
    Annotated[str, StringConstraints(max_length=MAX_ATTRIBUTE_STRING_LENGTH)] | JsNumber | bool
)
Attributes = Annotated[
    dict[FieldKey, AttributeValue],
    Field(max_length=MAX_FIELDS_PER_RECORD),
    BeforeValidator(_drop_proto),
]


class Usage(ContractModel):
    source: UsageSource
    estimated_at: UtcTimestamp | None = None
    values: UsageValues

    @field_validator("estimated_at", mode="before")
    @classmethod
    def _absent_not_null(cls, value: object) -> object:
        """Opcional, mas `null` explícito é recusado, como no `.optional()` do zod."""
        if value is None:
            raise PydanticCustomError("string_type", "Input should be a valid string")
        return value


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

    schema_version: Annotated[Literal[1], BeforeValidator(_not_bool)]
    region: Region
    workload: Workload
    blocks: Annotated[list[Block], Field(max_length=MAX_BLOCKS)]
    edges: Annotated[list[Edge], Field(max_length=MAX_EDGES)]
    scenarios: Annotated[list[object], Field(max_length=0)]

    @model_validator(mode="after")
    def _check_graph(self) -> Self:
        """As regras do `superRefine` do zod, com o mesmo caminho e a mesma mensagem."""
        issues: list[InitErrorDetails] = []

        def issue(where: str, i: int, field: str, message: str) -> None:
            error = PydanticCustomError("design_graph", message)
            value = getattr(getattr(self, where)[i], field)
            issues.append(InitErrorDetails(type=error, loc=(where, i, field), input=value))

        block_ids: set[str] = set()
        for i, block in enumerate(self.blocks):
            if block.id in block_ids:
                issue("blocks", i, "id", "Id de bloco repetido.")
            block_ids.add(block.id)
        edge_ids: set[str] = set()
        for i, edge in enumerate(self.edges):
            if edge.id in edge_ids:
                issue("edges", i, "id", "Id de aresta repetido.")
            edge_ids.add(edge.id)
            if edge.source not in block_ids:
                issue("edges", i, "source", "A aresta parte de um bloco que não existe.")
            if edge.target != CLIENT_NODE_ID and edge.target not in block_ids:
                issue("edges", i, "target", "A aresta chega a um bloco que não existe.")
            if edge.target == edge.source:
                issue("edges", i, "target", "A aresta não pode ligar um bloco a ele mesmo.")
            if edge.target == CLIENT_NODE_ID and edge.kind != "data":
                issue("edges", i, "kind", "Só arestas de dados chegam à internet.")
        if issues:
            # Um `ValidationError` levantado aqui mantém o `loc` de cada erro (prefixado por fora).
            raise ValidationError.from_exception_data(type(self).__name__, issues)
        return self


def doc_size_bytes(doc: DesignDocument) -> int:
    """Bytes UTF-8 do JSON compacto do documento, como o `sizeBytes` do ADR."""
    return len(doc.model_dump_json(by_alias=True, exclude_none=True).encode())
