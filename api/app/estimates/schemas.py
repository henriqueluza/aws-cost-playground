"""Entrada e saída da estimativa de uso (espelham `estimateRequestSchema` do `web/`)."""

from typing import Annotated, Literal

from pydantic import Field

from app.design_document import (
    MAX_BLOCKS,
    MAX_EDGES,
    Attributes,
    BlockId,
    BlockTypeName,
    ContractModel,
    Description,
    EdgeId,
    EdgeKind,
    Region,
    UsageValues,
)
from app.quotas.schemas import QuotaOut


class EstimateBlockIn(ContractModel):
    id: BlockId
    type: BlockTypeName
    attributes: Attributes


class EstimateEdgeIn(ContractModel):
    id: EdgeId
    source: BlockId
    target: BlockId | Literal["client"]
    kind: EdgeKind


class EstimateIn(ContractModel):
    region: Region
    description: Description
    blocks: Annotated[list[EstimateBlockIn], Field(max_length=MAX_BLOCKS)]
    edges: Annotated[list[EstimateEdgeIn], Field(max_length=MAX_EDGES)]


class EstimateBlockOut(ContractModel):
    id: BlockId
    values: UsageValues


class EstimateEdgeOut(ContractModel):
    id: EdgeId
    values: UsageValues


class EstimateOut(ContractModel):
    blocks: Annotated[list[EstimateBlockOut], Field(max_length=MAX_BLOCKS)]
    edges: Annotated[list[EstimateEdgeOut], Field(max_length=MAX_EDGES)]
    quota: QuotaOut
