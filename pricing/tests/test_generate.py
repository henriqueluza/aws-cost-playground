import itertools
import json
import os
from collections.abc import Callable, Sequence
from datetime import UTC, datetime
from pathlib import Path

import pytest

from app.generate import generate, seed, write
from app.model import (
    Dimension,
    Price,
    PricingError,
    Product,
    Query,
    ServiceSpec,
    Tier,
    region_filter,
)
from app.products import tiers
from app.render import render_price_file, sha256_hex

NOW = datetime(2026, 11, 23, 12, 0, 0, tzinfo=UTC)
US, SA = "us-east-1/lambda.json", "sa-east-1/lambda.json"


def queries(region: str) -> tuple[Query, ...]:
    return (Query("AWSLambda", (region_filter(region),)),)


def build(region: str, products: Sequence[Product]) -> Sequence[Price]:
    return [
        Price("lambda-requests", "Requisições", "request", tiers(p.dimensions)) for p in products
    ]


LAMBDA = ServiceSpec("lambda", "AWSLambda", queries, build, frozenset({"lambda-requests"}))
SQS = ServiceSpec("sqs", "AWSQueueService")


def fetch_at(usd: str, calls: list[Query] | None = None) -> Callable[[Query], list[Product]]:
    def fetch(query: Query) -> list[Product]:
        if calls is not None:
            calls.append(query)
        return [Product("ABC123", "Serverless", {}, (Dimension("Requests", "0", None, usd),))]

    return fetch


def tree(root: Path) -> dict[str, bytes]:
    return {
        str(p.relative_to(root)): p.read_bytes() for p in sorted(root.rglob("*")) if p.is_file()
    }


def put(root: Path, key: str, content: bytes) -> None:
    (root / key).parent.mkdir(parents=True, exist_ok=True)
    (root / key).write_bytes(content)


def test_generate_is_deterministic_and_does_not_write(tmp_path: Path) -> None:
    calls: list[Query] = []
    result = generate([LAMBDA], fetch_at("0.0000002", calls), tmp_path, NOW)
    assert list(result.files) == [SA, US, "manifest.json"]
    assert [q.filters[0].value for q in calls] == ["sa-east-1", "us-east-1"]
    manifest = json.loads(result.files["manifest.json"])
    assert (manifest["source"], manifest["generatedAt"]) == ("price-list", "2026-11-23T12:00:00Z")
    assert manifest["files"] == [
        {"path": key, "sha256": sha256_hex(result.files[key])} for key in (SA, US)
    ]
    assert json.loads(result.files[US])["prices"][0]["tiers"] == [
        {"upTo": None, "unitPrice": "0.0000002"}
    ]
    assert result.report == (
        f"{SA}: sem comparação: arquivo anterior ausente ou inválido",
        f"{US}: sem comparação: arquivo anterior ausente ou inválido",
    )
    assert generate([LAMBDA], fetch_at("0.0000002"), tmp_path, NOW) == result
    assert tree(tmp_path) == {}


def test_variation_is_reported_and_still_written(tmp_path: Path) -> None:
    write(tmp_path, generate([LAMBDA], fetch_at("1"), tmp_path, NOW).files)
    assert generate([LAMBDA], fetch_at("1"), tmp_path, NOW).report == ()
    result = generate([LAMBDA], fetch_at("1.5"), tmp_path, NOW)
    assert result.report == (
        f"{SA}: variação maior que 30%: lambda-requests faixa 0",
        f"{US}: variação maior que 30%: lambda-requests faixa 0",
    )
    write(tmp_path, result.files)
    assert tree(tmp_path) == dict(result.files)


def test_provisional_service_keeps_its_file_and_the_manifest_is_seed(tmp_path: Path) -> None:
    kept = render_price_file("sqs", "us-east-1", ())
    put(tmp_path, "us-east-1/sqs.json", kept)
    put(tmp_path, "sa-east-1/sqs.json", render_price_file("sqs", "sa-east-1", ()))
    result = generate([LAMBDA, SQS], fetch_at("1"), tmp_path, NOW)
    assert "us-east-1/sqs.json" not in result.files
    manifest = json.loads(result.files["manifest.json"])
    assert manifest["source"] == "seed"
    assert [f["path"] for f in manifest["files"]] == [
        SA,
        "sa-east-1/sqs.json",
        US,
        "us-east-1/sqs.json",
    ]
    assert manifest["files"][3]["sha256"] == sha256_hex(kept)
    assert result.report[-1] == "serviço provisório: sqs"


def test_only_provisional_services_write_nothing(tmp_path: Path) -> None:
    with pytest.raises(PricingError) as caught:
        generate([SQS], fetch_at("1"), tmp_path, NOW)
    assert str(caught.value).split("\n") == [
        "sa-east-1/sqs.json: arquivo ausente",
        "us-east-1/sqs.json: arquivo ausente",
    ]
    for region in ("us-east-1", "sa-east-1"):
        put(tmp_path, f"{region}/sqs.json", render_price_file("sqs", region, ()))
    result = generate([SQS], fetch_at("1"), tmp_path, NOW)
    assert dict(result.files) == {}
    assert result.report == (
        "serviço provisório: sqs",
        "nenhum serviço com consulta: nada a gravar",
    )


def test_every_failure_is_collected_and_blocks(tmp_path: Path) -> None:
    def broken(region: str, products: Sequence[Product]) -> Sequence[Price]:
        raise PricingError("falha fixa")

    put(
        tmp_path,
        US,
        render_price_file("lambda", "us-east-1", build("", fetch_at("1")(queries("")[0]))),
    )
    put(tmp_path, "us-east-1/sqs.json", b'{"VAZOU": 1}')
    put(tmp_path, "sa-east-1/sqs.json", render_price_file("sqs", "us-east-1", ()))
    specs = [
        LAMBDA,
        SQS,
        ServiceSpec("rds", "AmazonRDS", queries, broken),
        ServiceSpec("s3", "AmazonS3", queries, lambda region, products: ()),
    ]
    with pytest.raises(PricingError) as caught:
        generate(specs, fetch_at("0"), tmp_path, NOW)
    lines = str(caught.value).split("\n")
    assert f"{US}: preço zerado: lambda-requests" in lines
    assert "sa-east-1/sqs.json: serviço ou região diferente do caminho" in lines
    assert "us-east-1/sqs.json: schemaVersion: deve ser 1" in lines
    assert "us-east-1/rds.json: falha fixa" in lines
    assert "sa-east-1/s3.json: nenhum preço gerado" in lines
    assert "VAZOU" not in str(caught.value)


def test_output_outside_the_schema_blocks(tmp_path: Path) -> None:
    def bad(region: str, products: Sequence[Product]) -> Sequence[Price]:
        return [Price("sku com espaço", "d", "u", tiers(products[0].dimensions))]

    def garbage(region: str, products: Sequence[Product]) -> Sequence[Price]:
        return [Price("s3-storage", "d", "u", (Tier(None, "VAZOU"),))]

    with pytest.raises(PricingError, match=r"prices\[0\]\.sku: fora do formato"):
        generate([ServiceSpec("s3", "AmazonS3", queries, bad)], fetch_at("1"), tmp_path, NOW)
    put(tmp_path, "us-east-1/s3.json", render_price_file("s3", "us-east-1", ()))
    with pytest.raises(PricingError) as caught:
        generate([ServiceSpec("s3", "AmazonS3", queries, garbage)], fetch_at("1"), tmp_path, NOW)
    assert "unitPrice: decimal fora do formato" in str(caught.value)
    assert "VAZOU" not in str(caught.value)


def test_fetch_failure_blocks(tmp_path: Path) -> None:
    def fetch(query: Query) -> list[Product]:
        raise PricingError("GetProducts falhou para AWSLambda")

    with pytest.raises(PricingError, match="GetProducts falhou"):
        generate([LAMBDA], fetch, tmp_path, NOW)


def test_seed_manifest_is_deterministic_and_line_stable(tmp_path: Path) -> None:
    for spec in (LAMBDA, SQS):
        for region in ("us-east-1", "sa-east-1"):
            put(tmp_path, f"{region}/{spec.slug}.json", render_price_file(spec.slug, region, ()))
    first = seed([LAMBDA, SQS], tmp_path)
    assert first == seed([SQS, LAMBDA], tmp_path)
    assert first.report == ("manifest seed com 4 arquivos",)
    before = first.files["manifest.json"].decode().split("\n")
    assert json.loads(first.files["manifest.json"])["generatedAt"] == "2026-11-25T00:00:00Z"
    # Um bloco troca só os seus arquivos: no manifest mudam só as linhas de sha256 deles,
    # com linhas iguais entre uma entrada e outra (dois blocos não entram em conflito de merge).
    put(
        tmp_path,
        US,
        render_price_file("lambda", "us-east-1", build("", fetch_at("1")(queries("")[0]))),
    )
    after = seed([LAMBDA, SQS], tmp_path).files["manifest.json"].decode().split("\n")
    changed = [i for i, (old, new) in enumerate(zip(before, after, strict=True)) if old != new]
    assert len(changed) == 1
    assert after[changed[0] - 1] == f'      "path": "{US}",'
    assert after[changed[0]].startswith('      "sha256": "')
    paths = [i for i, line in enumerate(before) if '"path"' in line]
    assert all(b - a == 4 for a, b in itertools.pairwise(paths))


def test_seed_rejects_missing_or_invalid_files(tmp_path: Path) -> None:
    put(tmp_path, US, b"VAZOU")
    with pytest.raises(PricingError) as caught:
        seed([LAMBDA], tmp_path)
    assert str(caught.value).split("\n") == [
        f"{SA}: arquivo ausente",
        f"{US}: não é JSON válido ou passa de 500 KB",
    ]


def test_manifest_over_the_file_limit_blocks(tmp_path: Path) -> None:
    specs = [ServiceSpec(f"s{i}", "AmazonS3") for i in range(51)]
    for spec in specs:
        for region in ("us-east-1", "sa-east-1"):
            put(tmp_path, f"{region}/{spec.slug}.json", render_price_file(spec.slug, region, ()))
    assert len(json.loads(seed(specs[:50], tmp_path).files["manifest.json"])["files"]) == 100
    with pytest.raises(PricingError, match="manifest fora do schema"):
        seed(specs, tmp_path)


@pytest.mark.parametrize(
    "key",
    [
        "../x.json",
        "us-east-1/../../x.json",
        "/abs/x.json",
        "eu-west-1/s3.json",
        "us-east-1/s3.txt",
        "us-east-1/a/s3.json",
        "x.json",
        "us-east-1/s3",
    ],
)
def test_write_only_inside_the_output_directory(tmp_path: Path, key: str) -> None:
    out = tmp_path / "prices"
    with pytest.raises(PricingError, match="falha ao gravar o catálogo"):
        write(out, {US: b"a", key: b"b", "manifest.json": b"m"})
    assert tree(tmp_path) == {}


def test_write_replaces_atomically_with_the_manifest_last(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    replaced: list[str] = []
    real = os.replace

    def spy(source: str, target: Path) -> None:
        assert Path(source).parent == target.parent
        replaced.append(target.name)
        real(source, target)

    monkeypatch.setattr(os, "replace", spy)
    write(tmp_path, {"manifest.json": b"m", US: b"a", SA: b"b"})
    assert replaced == ["lambda.json", "lambda.json", "manifest.json"]
    assert tree(tmp_path) == {"manifest.json": b"m", US: b"a", SA: b"b"}


def test_failed_write_leaves_the_directory_intact(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    write(tmp_path, {US: b"old", "manifest.json": b"old"})
    before = tree(tmp_path)
    calls: list[int] = []

    def fsync(descriptor: int) -> None:
        calls.append(descriptor)
        if len(calls) == 2:
            raise OSError("disco cheio")

    monkeypatch.setattr(os, "fsync", fsync)
    with pytest.raises(PricingError, match="falha ao gravar o catálogo"):
        write(tmp_path, {US: b"new", "manifest.json": b"new"})
    assert tree(tmp_path) == before


def test_failed_rename_is_reported_and_leaves_no_temporary(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    write(tmp_path, {SA: b"old", US: b"old", "manifest.json": b"old"})
    real = os.replace
    calls: list[Path] = []

    def replace(source: str, target: Path) -> None:
        calls.append(target)
        if len(calls) == 2:
            raise OSError("disco cheio")
        real(source, target)

    monkeypatch.setattr(os, "replace", replace)
    with pytest.raises(PricingError, match="falha ao gravar o catálogo"):
        write(tmp_path, {SA: b"new", US: b"new", "manifest.json": b"new"})
    # O manifest antigo fica: o web/ recusa pelo sha256 o arquivo que já foi trocado.
    assert tree(tmp_path) == {SA: b"new", US: b"old", "manifest.json": b"old"}


def test_write_refuses_a_region_directory_linked_outside(tmp_path: Path) -> None:
    out, outside = tmp_path / "prices", tmp_path / "fora"
    out.mkdir()
    outside.mkdir()
    (out / "us-east-1").symlink_to(outside, target_is_directory=True)
    with pytest.raises(PricingError, match="falha ao gravar o catálogo"):
        write(out, {SA: b"a", US: b"b", "manifest.json": b"m"})
    assert tree(outside) == {}
    assert tree(out) == {}
