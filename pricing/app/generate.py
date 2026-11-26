"""Monta o catálogo em memória, confere tudo e só então grava (arquivo temporário + rename)."""

import contextlib
import os
import tempfile
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from app.catalog import MANIFEST, REGIONS, file_key
from app.checks import blocking, parse_price_file, regression, variation
from app.model import PricingError, Product, Query, ServiceSpec
from app.render import render_manifest, render_price_file, sha256_hex
from app.schema import validate_manifest, validate_price_file

Fetch = Callable[[Query], Sequence[Product]]

# Data fixa do manifest `seed`: o comando `seed` dá sempre os mesmos bytes para os mesmos arquivos.
SEED_GENERATED_AT = datetime(2026, 11, 25, tzinfo=UTC)


@dataclass(frozen=True, slots=True)
class Result:
    """Arquivos a gravar (chave relativa a prices/, com `manifest.json`) e o relatório."""

    files: Mapping[str, bytes]
    report: tuple[str, ...]


def _read(prices_dir: Path, key: str) -> bytes | None:
    try:
        return (prices_dir / key).read_bytes()
    except OSError:
        return None


def _file_errors(content: bytes, region: str, slug: str) -> list[str]:
    """Erros de um arquivo de preço já em bytes: JSON, schema e serviço/região do caminho."""
    doc = parse_price_file(content)
    if not isinstance(doc, dict):
        return ["não é JSON válido ou passa de 500 KB"]
    errors = validate_price_file(doc)
    if (doc.get("region"), doc.get("service")) != (region, slug):
        errors.append("serviço ou região diferente do caminho")
    return errors


def _manifest(hashes: Mapping[str, str], now: datetime, *, seed: bool) -> bytes:
    content = render_manifest(hashes, now, "seed" if seed else "price-list")
    if validate_manifest(parse_price_file(content)):
        raise PricingError("manifest fora do schema")
    return content


def _fail(errors: Sequence[str]) -> None:
    if errors:
        raise PricingError("\n".join(errors))


def generate(specs: Sequence[ServiceSpec], fetch: Fetch, prices_dir: Path, now: datetime) -> Result:
    """Catálogo a partir da Price List; não grava. Junta todos os erros num `PricingError`.

    Serviço provisório (sem consulta) não gera arquivo: o arquivo versionado é exigido, mantido e
    entra no manifest, que então sai como `seed`. Sem nenhum serviço com consulta, nada é gravado.
    """
    files: dict[str, bytes] = {}
    kept: dict[str, bytes] = {}
    report: list[str] = []
    errors: list[str] = []
    provisional: set[str] = set()
    for spec in specs:
        for region in sorted(REGIONS):
            key = file_key(region, spec.slug)
            previous = _read(prices_dir, key)
            queries = spec.queries(region)
            if not queries:
                provisional.add(spec.slug)
                if previous is None:
                    errors.append(f"{key}: arquivo ausente")
                else:
                    kept[key] = previous
                    errors.extend(f"{key}: {e}" for e in _file_errors(previous, region, spec.slug))
                continue
            try:
                products = [product for query in queries for product in fetch(query)]
                prices = tuple(spec.build(region, products))
            except PricingError as exc:
                errors.append(f"{key}: {exc}")
                continue
            content = render_price_file(spec.slug, region, prices)
            problems = [*blocking(spec, prices, content), *_file_errors(content, region, spec.slug)]
            # A comparação com o arquivo anterior só roda sobre preços já aprovados pelo schema.
            problems = problems or regression(previous, prices)
            if problems:
                errors.extend(f"{key}: {problem}" for problem in problems)
                continue
            files[key] = content
            report.extend(f"{key}: {line}" for line in variation(previous, prices))
    _fail(errors)
    report.extend(f"serviço provisório: {slug}" for slug in sorted(provisional))
    if not files:
        return Result({}, (*report, "nenhum serviço com consulta: nada a gravar"))
    hashes = {key: sha256_hex(content) for key, content in (kept | files).items()}
    files[MANIFEST] = _manifest(hashes, now, seed=bool(provisional))
    return Result(files, tuple(report))


def seed(specs: Sequence[ServiceSpec], prices_dir: Path) -> Result:
    """Manifest `seed` dos arquivos versionados em prices/; não consulta a AWS nem usa o relógio."""
    hashes: dict[str, str] = {}
    errors: list[str] = []
    for spec in specs:
        for region in sorted(REGIONS):
            key = file_key(region, spec.slug)
            content = _read(prices_dir, key)
            if content is None:
                errors.append(f"{key}: arquivo ausente")
                continue
            errors.extend(f"{key}: {e}" for e in _file_errors(content, region, spec.slug))
            hashes[key] = sha256_hex(content)
    _fail(errors)
    manifest = _manifest(hashes, SEED_GENERATED_AT, seed=True)
    return Result({MANIFEST: manifest}, (f"manifest seed com {len(hashes)} arquivos",))


def write(prices_dir: Path, files: Mapping[str, bytes]) -> None:
    """Grava dentro de `prices_dir`: tudo em arquivo temporário, depois rename, manifest por último.

    A chave de cada arquivo passa pela allowlist de `file_key` e o diretório da região não pode
    ser link para fora. Nada é trocado se algum temporário falhar. Se um rename falhar no meio,
    o manifest antigo fica e o `web/` recusa o arquivo trocado pelo `sha256`.
    """
    staged: list[tuple[str, Path]] = []
    base = prices_dir.resolve()
    try:
        for key in files:
            region, _, name = key.partition("/")
            if key != MANIFEST and file_key(region, name.removesuffix(".json")) != key:
                raise ValueError("chave fora do formato")
        for key in sorted(files, key=lambda k: (k == MANIFEST, k)):
            target = prices_dir / key
            target.parent.mkdir(parents=True, exist_ok=True)
            if not target.parent.resolve().is_relative_to(base):
                raise ValueError("diretório de saída aponta para fora")
            handle, temporary = tempfile.mkstemp(dir=target.parent, prefix=".tmp-", suffix=".json")
            staged.append((temporary, target))
            with os.fdopen(handle, "wb") as stream:
                stream.write(files[key])
                stream.flush()
                os.fsync(stream.fileno())
            os.chmod(temporary, 0o644)
        for temporary, target in staged:
            os.replace(temporary, target)
    except OSError, ValueError:
        raise PricingError("falha ao gravar o catálogo") from None
    finally:
        for temporary, _ in staged:
            with contextlib.suppress(OSError):
                os.unlink(temporary)
