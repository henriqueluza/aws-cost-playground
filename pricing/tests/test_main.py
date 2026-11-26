from collections.abc import Sequence
from pathlib import Path

import pytest

import app.__main__ as cli
from app.model import Dimension, Price, Product, Query, ServiceSpec, region_filter
from app.products import tiers
from app.render import render_price_file

PRICES = Path("web/public/prices")


def build(region: str, products: Sequence[Product]) -> Sequence[Price]:
    return [Price("s3-storage", "Armazenamento", "GB-month", tiers(products[0].dimensions))]


S3 = ServiceSpec(
    "s3", "AmazonS3", lambda region: (Query("AmazonS3", (region_filter(region),)),), build
)


@pytest.fixture(autouse=True)
def fake_aws(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """Registro e cliente de teste: a CLI não depende dos serviços reais nem da AWS."""
    usd = ["0.023"]

    def fetch(client: object, query: Query) -> list[Product]:
        assert client == "cliente"
        return [Product("ABC", "Storage", {}, (Dimension("GB-Mo", "0", None, usd[0]),))]

    monkeypatch.setattr(cli, "SERVICES", (S3,))
    monkeypatch.setattr(cli, "make_client", lambda: "cliente")
    monkeypatch.setattr(cli, "fetch_products", fetch)
    return usd


def files(root: Path) -> dict[str, bytes]:
    return {str(p.relative_to(root)): p.read_bytes() for p in root.rglob("*") if p.is_file()}


def test_generate_writes_and_reports(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    assert cli.main(["--root", str(tmp_path)]) == 0
    written = files(tmp_path / PRICES)
    assert sorted(written) == ["manifest.json", "sa-east-1/s3.json", "us-east-1/s3.json"]
    assert "sem comparação" in capsys.readouterr().out
    assert cli.main(["generate", "--root", str(tmp_path)]) == 0
    assert files(tmp_path / PRICES) == written


def test_failed_check_exits_1_and_writes_nothing(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], fake_aws: list[str]
) -> None:
    assert cli.main(["--root", str(tmp_path)]) == 0
    before = files(tmp_path)
    capsys.readouterr()
    fake_aws[0] = "0"
    assert cli.main(["--root", str(tmp_path)]) == 1
    captured = capsys.readouterr()
    assert captured.out == ""
    assert "us-east-1/s3.json: preço zerado: s3-storage" in captured.err
    assert files(tmp_path) == before


def test_seed_rewrites_only_the_manifest(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    clients: list[int] = []
    monkeypatch.setattr(cli, "make_client", lambda: clients.append(1))
    assert cli.main(["seed", "--root", str(tmp_path)]) == 1
    assert "us-east-1/s3.json: arquivo ausente" in capsys.readouterr().err
    assert files(tmp_path) == {}
    for region in ("us-east-1", "sa-east-1"):
        target = tmp_path / PRICES / region / "s3.json"
        target.parent.mkdir(parents=True)
        target.write_bytes(render_price_file("s3", region, ()))
    assert cli.main(["seed", "--root", str(tmp_path)]) == 0
    assert capsys.readouterr().out == "manifest seed com 2 arquivos\n"
    first = files(tmp_path)
    assert b'"source": "seed"' in first["web/public/prices/manifest.json"]
    assert cli.main(["seed", "--root", str(tmp_path)]) == 0
    assert files(tmp_path) == first
    assert clients == []


def test_default_root_is_the_repository() -> None:
    assert (Path(cli.__file__).resolve().parents[2] / "pricing/app/__main__.py").is_file()
