"""Caminhos do catálogo de preços gerado em web/public/prices."""

import re
from pathlib import Path

REGIONS = frozenset({"us-east-1", "sa-east-1"})
_SERVICE = re.compile(r"[a-z0-9-]{1,64}")


def output_path(root: Path, region: str, service: str) -> Path:
    """Devolve o JSON do serviço na região; rejeita entradas que escapem de prices/."""
    if region not in REGIONS or not _SERVICE.fullmatch(service):
        raise ValueError(f"região ou serviço inválido: {region!r}, {service!r}")
    return root / "web/public/prices" / region / f"{service}.json"
