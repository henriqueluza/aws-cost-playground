# api — aws-cost-playground

API em Python + FastAPI + Pydantic v2, executada em AWS Lambda atrás do API Gateway HTTP API. Stack e decisões: `docs/architecture/aws-cost-playground/ADR-0001-stack.md`. Nível de arquitetura: `simple`.

Hoje é só o esqueleto: não há rotas e o OpenAPI (`/docs`, `/redoc`, `/openapi.json`) está desligado.

## Pré-requisitos

- Python 3.14 (veja `.python-version`).
- [uv](https://docs.astral.sh/uv/). O `pyproject.toml` define `exclude-newer = "7 days"`: o uv só resolve versões publicadas há pelo menos 7 dias.

## Uso

```bash
uv sync   # instala conforme o uv.lock (inclui o grupo dev)
```

## Qualidade

```bash
uv run ruff format --check . && uv run ruff check . && uv run mypy app && uv run lint-imports && uv run pytest -q --cov
```

Os testes usam `moto` para o DynamoDB; não precisam de credenciais AWS.

## Variáveis de ambiente

| Variável | Obrigatória | Descrição |
|---|---|---|
| `TABLE_NAME` | sim | Nome da tabela única do DynamoDB (3 a 255 caracteres). Sem ela, a função falha ao iniciar. |
| `LOG_LEVEL` | não | `DEBUG`, `INFO` (padrão), `WARNING` ou `ERROR`. |

Nenhum segredo vai em código nem em variável commitada.

## Estrutura de `app/`

- `main.py` — composition root: `create_app()` e o `handler` da Lambda.
- `config.py` — `Settings`, lidas só do ambiente.
- `auth.py` — identidade do usuário.
- `dynamo.py` — acesso à tabela única (`get_table()`).
- `designs/`, `estimates/`, `quotas/`, `account/` — um pacote por funcionalidade (ainda vazios). Cada um segue `router` → `service` → repositório.

## Identidade

A identidade vem só do claim `sub` do JWT, já validado pelo authorizer do API Gateway. `app/auth.py` é o único ponto que a lê (`CurrentUserId`, dependência do FastAPI), a partir do evento da Lambda; a API não lê o token nem cabeçalhos. Sem `sub` válido, responde 401. O `sub` aceita só `[A-Za-z0-9-]`, para não quebrar a chave `USER#<sub>`.

## Lint de arquitetura

O `import-linter` (`uv run lint-imports`, contrato em `pyproject.toml`) proíbe que `app.*.router` importe `boto3`, `botocore` ou `anthropic` diretamente. Routers falam com services; só estes (ou repositórios) acessam AWS e a Claude API. O teste `tests/test_architecture.py` cobre o contrato.

## Por que Mangum

O Mangum adapta o evento do API Gateway (payload 2.0) para ASGI, então o FastAPI roda na Lambda sem mudanças e expõe o evento original em `scope["aws.event"]`, de onde `auth.py` lê os claims. Foi o adapter escolhido na Issue do esqueleto, como o ADR-0001 previa. A Lambda usa `lifespan="off"`.
