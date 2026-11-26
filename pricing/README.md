# pricing — aws-cost-playground

Script Python executado no CI que vai gerar o catálogo de preços (`web/public/prices/<region>/<service>.json`) a partir da AWS Price List API. Stack e decisões: `docs/architecture/aws-cost-playground/ADR-0001-stack.md`. Nível de arquitetura: `simple`.

O gerador está em construção (Issue #28, em partes: #195, #202 e #196). Hoje há o cliente da Price List Query API (`GetProducts`, região `us-east-1`), que usa as credenciais da cadeia padrão do ambiente (variáveis `AWS_*`, perfil ou role do CI). Ainda não há CLI, registro de serviços nem gravação dos JSON.

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

Os testes não fazem rede nem precisam de credenciais AWS: simulam o `GetProducts` com `botocore.stub.Stubber`.

## Estrutura de `app/`

- `catalog.py` — `REGIONS` (`us-east-1` e `sa-east-1`) e `output_path(root, region, service)`, que devolve o caminho do JSON de um serviço em uma região.
- `model.py` — tipos do gerador (`Filter`, `Query`, `Dimension`, `Product`, `Tier`, `FreeTier`, `Price`, `ServiceSpec`), `region_filter`, `PricingError` e `decimal_text`.
- `products.py` — `parse_product` (parse defensivo de um item do PriceList) e `tiers` (faixas de preço de uma dimensão).
- `client.py` — `make_client` (cliente boto3 `pricing` em `us-east-1`) e `fetch_products` (`GetProducts` paginado, com filtros).

O registro dos serviços ficará em `app/services/` (e não em `pricing/services/`, como diz o texto da #28 e das Issues de bloco). Motivo: mypy, cobertura e import-linter já cobrem `app`; fora dele o código ficaria sem essas checagens.

## Validação de caminho

`output_path` só aceita região da lista fechada `REGIONS` e serviço no formato `[a-z0-9-]{1,64}`. Qualquer outra entrada levanta `ValueError`, o que impede que `..` ou separadores de caminho façam a escrita escapar de `web/public/prices/`.

## Lint de arquitetura

O `import-linter` (`uv run lint-imports`, contrato `forbidden` em `pyproject.toml`) proíbe que `app` importe `fastapi`, `anthropic` ou `mangum`. Esses pacotes pertencem à `api/`; o script de preços usa só `boto3`.
