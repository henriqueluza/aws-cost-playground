"""Falhas das rotas de designs. A `DesignRoute` (router) as converte em problem details."""


class DesignError(Exception):
    """Base. `status` e `detail` são fixos por classe: nenhum texto da AWS nem do usuário."""

    status = 500
    detail: str | None = None


class DesignNotFound(DesignError):
    """Não existe na partição de quem pede. Design de outro usuário cai aqui, sem distinção."""

    status = 404


class DesignLimitReached(DesignError):
    status = 409
    detail = "Design limit reached"


class VersionConflict(DesignError):
    """A `version` gravada não é a esperada: outra aba ou outro dispositivo gravou antes."""

    status = 409
    detail = "Version conflict"


class StoreUnavailable(DesignError):
    """DynamoDB indisponível, limitando taxa ou inalcançável: vale tentar de novo."""

    status = 503


class StoreFailure(DesignError):
    """Qualquer outra falha do DynamoDB (permissão, parâmetro, credencial)."""


class CorruptedDesign(DesignError):
    """Item gravado que não passa no schema de saída."""
