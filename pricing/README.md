# pricing — aws-cost-playground

Script Python executado no CI que vai gerar o catálogo de preços (`web/public/prices/<region>/<service>.json`) a partir da AWS Price List API. Stack e decisões: `docs/architecture/aws-cost-playground/ADR-0001-stack.md`. Nível de arquitetura: `simple`.

Hoje é só o esqueleto: não há CLI, variáveis de ambiente nem chamada à AWS. O gerador vem na Issue #28.

## Pré-requisitos

- Python 3.14 (veja `.python-version`).
- [uv](https://docs.astral.sh/uv/) 0.13.8 ou superior (`required-version` no `pyproject.toml`). O `pyproject.toml` define `exclude-newer = "7 days"`: o uv só resolve versões publicadas há pelo menos 7 dias.

## Uso

```bash
uv sync   # instala conforme o uv.lock (inclui o grupo dev)
```

## Qualidade

```bash
uv run ruff format --check . && uv run ruff check . && uv run mypy app && uv run lint-imports && uv run pytest -q --cov
```

Os testes não fazem rede nem precisam de credenciais AWS.

## Estrutura de `app/`

- `catalog.py` — `REGIONS` (`us-east-1` e `sa-east-1`) e `output_path(root, region, service)`, que devolve o caminho do JSON de um serviço em uma região.

## Validação de caminho

`output_path` só aceita região da lista fechada `REGIONS` e serviço no formato `[a-z0-9-]{1,64}`. Qualquer outra entrada levanta `ValueError`, o que impede que `..` ou separadores de caminho façam a escrita escapar de `web/public/prices/`.

## Lint de arquitetura

O `import-linter` (`uv run lint-imports`, contrato `forbidden` em `pyproject.toml`) proíbe que `app` importe `fastapi`, `anthropic` ou `mangum`. Esses pacotes pertencem à `api/`; o script de preços usa só `boto3`.
