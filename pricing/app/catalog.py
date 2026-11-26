"""Caminhos do catálogo de preços gerado em web/public/prices."""

import re
from pathlib import Path

REGIONS = frozenset({"us-east-1", "sa-east-1"})
PRICES_DIR = Path("web/public/prices")
MANIFEST = "manifest.json"
_SERVICE = re.compile(r"[a-z][a-z0-9-]{0,39}")


def file_key(region: str, service: str) -> str:
    """`<region>/<service>.json`, relativo a prices/; rejeita o que escaparia do diretório."""
    if region not in REGIONS or not _SERVICE.fullmatch(service):
        raise ValueError(f"região ou serviço inválido: {region!r}, {service!r}")
    return f"{region}/{service}.json"


def output_path(root: Path, region: str, service: str) -> Path:
    """Devolve o JSON do serviço na região; rejeita entradas que escapem de prices/."""
    return root / PRICES_DIR / file_key(region, service)
