"""Saída da quota de estimativas (espelha `quotaSchema` do `web/`)."""

from typing import Annotated

from pydantic import Field

from app.design_document import ContractModel, UtcTimestamp


class QuotaOut(ContractModel):
    limit: Annotated[int, Field(ge=0)]
    remaining: Annotated[int, Field(ge=0)]
    resets_at: UtcTimestamp
