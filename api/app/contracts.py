"""Leitor de `contracts/blocks.json` e `edges.json`, os mesmos arquivos do `web/`.

Faixas de uso, padrões e opções vêm só desses arquivos; as regras repetem o schema zod de
`web/src/features/pricing/model/blockContract.ts`. Só a tabela de níveis do PRD é copiada.
"""

from collections.abc import Mapping
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from types import MappingProxyType
from typing import Annotated, Literal, Self, get_args

from pydantic import (
    AfterValidator,
    Field,
    StringConstraints,
    model_validator,
)

from app.design_document import (
    CLIENT_NODE_ID,
    MAX_FIELDS_PER_RECORD,
    ContractModel,
    EdgeKind,
    FieldKey,
    JsNumber,
    NotNull,
    SchemaVersion,
    UsageNumber,
)

BlockLevel = Literal["A", "B", "C"]
# fmt: off
BlockType = Literal[
    "aws.ec2", "aws.lambda", "aws.rds", "aws.dynamodb", "aws.elasticache", "aws.s3", "aws.sqs",
    "aws.cloudfront", "aws.alb", "aws.cloudwatch", "aws.nat-gateway", "aws.waf", "aws.cognito",
    "aws.secrets-manager", "aws.cloudtrail", "aws.route53", "aws.codepipeline", "aws.iam",
    "aws.cloudformation", "aws.ecs",
]
BlockCategory = Literal[
    "compute", "storage", "database", "networking", "integration", "security", "management",
    "devtools",
]
PRD_BLOCK_LEVELS: dict[BlockType, BlockLevel] = {
    "aws.ec2": "A", "aws.lambda": "A", "aws.rds": "A", "aws.dynamodb": "A",
    "aws.elasticache": "A", "aws.s3": "A", "aws.sqs": "A", "aws.cloudfront": "A", "aws.alb": "A",
    "aws.cloudwatch": "A", "aws.nat-gateway": "A",
    "aws.waf": "B", "aws.cognito": "B", "aws.secrets-manager": "B", "aws.cloudtrail": "B",
    "aws.route53": "B", "aws.codepipeline": "B",
    "aws.iam": "C", "aws.cloudformation": "C", "aws.ecs": "C",
}
"""Os 20 blocos do PRD (F2) e o nível de preço de cada um (F10 a F12). `C` é custo zero."""
# fmt: on

# Limites do schema zod (`BLOCK_CONTRACT_LIMITS` e o 64 das opções), em pontos de código.
MAX_OPTIONS = 32
MAX_TEXT_LENGTH = 40
MAX_OPTION_LENGTH = 64
_SEARCH_DIRS = tuple(parent / "contracts" for parent in Path(__file__).resolve().parents[1:3])
"""Zip da Lambda (`/var/task/contracts`) e, depois, a raiz do repositório."""


Text = Annotated[str, StringConstraints(min_length=1, max_length=MAX_TEXT_LENGTH)]
OptionText = Annotated[str, StringConstraints(min_length=1, max_length=MAX_OPTION_LENGTH)]
OptionValue = OptionText | JsNumber


class AttributeDefinition(ContractModel):
    """Atributo do SKU: conjunto fechado de opções. Sem `default`, é opcional (ex.: `az`)."""

    key: FieldKey
    options: Annotated[list[OptionValue], Field(min_length=1, max_length=MAX_OPTIONS)]
    default: Annotated[OptionValue | None, NotNull] = None

    @model_validator(mode="after")
    def _check(self) -> Self:
        if len(set(self.options)) != len(self.options):
            raise ValueError("Opção repetida.")
        if len({isinstance(option, str) for option in self.options}) != 1:
            raise ValueError("Opções de tipos diferentes.")
        if self.default is not None and self.default not in self.options:
            raise ValueError("O padrão não está entre as opções.")
        return self


class UsageKeyDefinition(ContractModel):
    """Chave de uso: número com unidade, padrão e faixa plausível. `integer` recusa fração."""

    key: FieldKey
    unit: Text
    default: UsageNumber
    min: UsageNumber
    max: UsageNumber
    integer: bool

    @model_validator(mode="after")
    def _check(self) -> Self:
        if not self.min < self.max:
            raise ValueError("Faixa vazia.")
        if not self.min <= self.default <= self.max:
            raise ValueError("O padrão está fora da faixa.")
        numbers = (self.default, self.min, self.max)
        if self.integer and not all(float(number).is_integer() for number in numbers):
            raise ValueError("Chave inteira com padrão ou faixa fracionária.")
        return self


def _unique_keys[T: (AttributeDefinition, UsageKeyDefinition)](fields: list[T]) -> list[T]:
    if len({field.key for field in fields}) != len(fields):
        raise ValueError("Chave repetida.")
    return fields


FieldLimit = Field(max_length=MAX_FIELDS_PER_RECORD)
UsageKeys = Annotated[list[UsageKeyDefinition], FieldLimit, AfterValidator(_unique_keys)]


class BlockDefinition(ContractModel):
    """O que um tipo de bloco aceita. `name` é o nome do serviço, em inglês."""

    type: BlockType
    name: Text
    category: BlockCategory
    level: BlockLevel
    attributes: Annotated[list[AttributeDefinition], FieldLimit, AfterValidator(_unique_keys)]
    usage: UsageKeys

    @model_validator(mode="after")
    def _check(self) -> Self:
        if self.level != PRD_BLOCK_LEVELS[self.type]:
            raise ValueError("Nível diferente do PRD.")
        return self


class BlocksFile(ContractModel):
    schema_version: SchemaVersion
    blocks: Annotated[list[BlockDefinition], Field(max_length=len(PRD_BLOCK_LEVELS))]

    @model_validator(mode="after")
    def _check(self) -> Self:
        if len({block.type for block in self.blocks}) != len(self.blocks):
            raise ValueError("Tipo de bloco repetido.")
        return self


class EdgePair(ContractModel):
    """A aresta é aceita se a origem está em `sources` e o destino em `targets` de algum par."""

    sources: Annotated[list[BlockType], Field(min_length=1)]
    targets: Annotated[list[BlockType | Literal["client"]], Field(min_length=1)]


class EdgeKindDefinition(ContractModel):
    kind: EdgeKind
    usage: UsageKeys
    pairs: Annotated[list[EdgePair], Field(min_length=1, max_length=MAX_OPTIONS)]

    @model_validator(mode="after")
    def _check(self) -> Self:
        if self.kind != "data" and any(CLIENT_NODE_ID in pair.targets for pair in self.pairs):
            raise ValueError("Só arestas de dados chegam à internet.")
        return self


class EdgesFile(ContractModel):
    schema_version: SchemaVersion
    kinds: list[EdgeKindDefinition]

    @model_validator(mode="after")
    def _check(self) -> Self:
        if sorted(edge.kind for edge in self.kinds) != sorted(get_args(EdgeKind)):
            raise ValueError("Cada tipo de aresta aparece exatamente uma vez.")
        return self


@dataclass(frozen=True)
class Contracts:
    """Contratos validados, só leitura: blocos por tipo e arestas por kind."""

    blocks: Mapping[str, BlockDefinition]
    edges: Mapping[str, EdgeKindDefinition]


def load_contracts(directory: Path | None = None) -> Contracts:
    """Lê e valida `blocks.json` e `edges.json`. Contrato inválido levanta `ValidationError`."""
    candidates = (directory,) if directory is not None else _SEARCH_DIRS
    found = next((path for path in candidates if (path / "blocks.json").is_file()), None)
    if found is None:
        raise RuntimeError("Contratos não encontrados: falta contracts/blocks.json.")
    blocks = BlocksFile.model_validate_json((found / "blocks.json").read_bytes())
    edges = EdgesFile.model_validate_json((found / "edges.json").read_bytes())
    return Contracts(
        blocks=MappingProxyType({block.type: block for block in blocks.blocks}),
        edges=MappingProxyType({edge.kind: edge for edge in edges.kinds}),
    )


@lru_cache(maxsize=1)
def get_contracts() -> Contracts:
    """Contratos do pacote, lidos na primeira chamada e reutilizados entre invocações."""
    return load_contracts()
