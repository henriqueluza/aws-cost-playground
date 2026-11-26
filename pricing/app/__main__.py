"""CLI: `python -m app` (Price List) e `python -m app seed` (manifest dos arquivos versionados)."""

import argparse
import sys
from collections.abc import Sequence
from datetime import UTC, datetime
from pathlib import Path

from app.catalog import PRICES_DIR
from app.client import fetch_products, make_client
from app.generate import Result, generate, seed, write
from app.model import PricingError
from app.services import SERVICES


def _from_price_list(prices_dir: Path) -> Result:
    client = make_client()
    return generate(SERVICES, lambda q: fetch_products(client, q), prices_dir, datetime.now(UTC))


def main(argv: Sequence[str] | None = None) -> int:
    """Exit 1 e nada gravado se qualquer checagem falhar; o relatório vai para o stdout."""
    parser = argparse.ArgumentParser(prog="python -m app")
    parser.add_argument("command", nargs="?", choices=("generate", "seed"), default="generate")
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[2])
    args = parser.parse_args(argv)
    prices_dir = args.root / PRICES_DIR
    try:
        if args.command == "seed":
            result = seed(SERVICES, prices_dir)
        else:
            result = _from_price_list(prices_dir)
        write(prices_dir, result.files)
    except PricingError as exc:
        print(f"erro:\n{exc}", file=sys.stderr)
        return 1
    print("\n".join(result.report))
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
