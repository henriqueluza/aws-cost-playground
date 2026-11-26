import io

import pytest

from app.summary import MAX_ITEMS, main, pr_body

HEADINGS = [
    "## SKUs adicionados",
    "## SKUs removidos",
    "## Variações acima de 30%",
    "## Outros",
]

REPORT = [
    "us-east-1/lambda.json: SKU novo: lambda-requests",
    "sa-east-1/s3.json: SKU novo: s3-standard",
    "us-east-1/lambda.json: SKU removido: lambda-old",
    "us-east-1/dynamodb.json: variação maior que 30%: ddb-write faixa 0",
    "us-east-1/dynamodb.json: faixas mudaram: ddb-read",
    "sa-east-1/s3.json: sem comparação: arquivo anterior ausente ou inválido",
    "serviço provisório: cloudfront",
    "us-east-1/s3.json: SKU novo fora do formato",
    "",
]


def _section(body: str, heading: str) -> str:
    start = body.index(heading)
    rest = body[start + len(heading) :]
    end = rest.find("\n## ")
    return rest if end == -1 else rest[:end]


def test_groups_and_others() -> None:
    body = pr_body(REPORT)
    assert "- `us-east-1/lambda.json`: `lambda-requests`" in _section(body, HEADINGS[0])
    assert "- `sa-east-1/s3.json`: `s3-standard`" in _section(body, HEADINGS[0])
    assert "- `us-east-1/lambda.json`: `lambda-old`" in _section(body, HEADINGS[1])
    assert "- `us-east-1/dynamodb.json`: `ddb-write` faixa 0" in _section(body, HEADINGS[2])
    others = _section(body, HEADINGS[3])
    for line in (
        "- faixas mudaram: 1",
        "- sem comparação: 1",
        "- serviço provisório: 1",
        "- SKU novo fora do formato: 1",
    ):
        assert line in others
    assert "fora do padrão" not in others
    assert body.endswith("rodar o CI.\n")
    assert not body.endswith("\n\n")


def test_sections_in_order_and_empty() -> None:
    body = pr_body([])
    positions = [body.index(h) for h in HEADINGS]
    assert positions == sorted(positions)
    assert body.count("Nenhum.") == 4
    assert "GITHUB_TOKEN" in body


def test_untrusted_lines_only_counted() -> None:
    hostile = [
        "us-east-1/lambda.json: SKU novo: <img src=x onerror=alert(1)>",
        "us-east-1/lambda.json: SKU novo: @octocat",
        "us-east-1/lambda.json: SKU novo: `x`",
        "us-east-1/lambda.json: SKU novo: a b",
        "# titulo [link](http://evil) @octocat `",
        "us-east-1/lambda.json: SKU removido: lambda!requests",
        "us-east-1/lambda.json: variação maior que 30%: lambda-requests faixa ٣",
        "us-east-1/lambda.json: variação maior que 30%: lambda-requests faixa 123",
        "us-east-1/lambda.json: SKU novo: lambda-requests\n## injetado",
        "us-east-1/lambda.json: faixas mudaram: <b>x</b>",
        "us-east-1/lambda.json: algo desconhecido",
    ]
    body = pr_body(hostile)
    for fragment in ("<img", "@octocat", "evil", "injetado", "lambda!requests", "<b>"):
        assert fragment not in body
    assert f"- linhas fora do padrão: {len(hostile)}" in body
    assert body.count("\n## ") == 4


def test_invalid_file_not_listed() -> None:
    body = pr_body(
        [
            "eu-west-1/lambda.json: SKU novo: lambda-requests",
            "us-east-1/Lambda.json: SKU novo: lambda-requests",
            "us-east-1/9lambda.json: SKU novo: lambda-requests",
            "../x/lambda.json: SKU novo: lambda-requests",
            "us-east-1/lambda.json: SKU novo fora do formato",
            "eu-west-1/lambda.json: SKU novo fora do formato",
        ]
    )
    assert "lambda-requests" not in body
    assert "- linhas fora do padrão: 5" in body
    assert "- SKU novo fora do formato: 1" in body


def test_provisional_slug_must_be_valid() -> None:
    body = pr_body(["serviço provisório: <x>", "serviço provisório: ec2"])
    assert "- serviço provisório: 1" in body
    assert "- linhas fora do padrão: 1" in body


def test_cut_at_limit() -> None:
    skus = [f"sku-{i}" for i in range(MAX_ITEMS + 7)]
    body = pr_body([f"us-east-1/lambda.json: SKU novo: {s}" for s in skus])
    section = _section(body, HEADINGS[0])
    assert section.count("\n- `") == MAX_ITEMS
    assert "- e mais 7" in section
    assert f"`sku-{MAX_ITEMS}`" not in body
    exact = pr_body([f"us-east-1/lambda.json: SKU novo: sku-{i}" for i in range(MAX_ITEMS)])
    assert "e mais" not in exact


def test_nothing_to_write() -> None:
    body = pr_body(["nenhum serviço com consulta: nada a gravar"])
    assert "Nenhum serviço com consulta: nada foi gravado." in _section(body, HEADINGS[3])
    assert "fora do padrão" not in body


def test_deterministic() -> None:
    assert pr_body(REPORT) == pr_body(list(REPORT))


def test_main_with_streams() -> None:
    out = io.StringIO()
    assert main(io.StringIO("\n".join(REPORT)), out) == 0
    assert out.getvalue() == pr_body(REPORT)


def test_main_defaults_to_std_streams(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr("sys.stdin", io.StringIO("serviço provisório: ec2\n"))
    assert main() == 0
    assert "- serviço provisório: 1" in capsys.readouterr().out
