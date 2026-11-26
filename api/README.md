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
- `errors.py` — erros no formato problem details (`install_error_handlers`).
- `logs.py` — logs JSON, id da requisição e `RequestLogMiddleware`.
- `dynamo.py` — acesso à tabela única (`get_table()`).
- `designs/`, `estimates/`, `quotas/`, `account/` — um pacote por funcionalidade (ainda vazios). Cada um segue `router` → `service` → repositório.

## Identidade

A identidade vem só do claim `sub` do JWT, já validado pelo authorizer do API Gateway. `app/auth.py` é o único ponto que a lê (`CurrentUserId`, dependência do FastAPI), a partir do evento da Lambda; a API não lê o token nem cabeçalhos. Sem `sub` válido, responde 401. O `sub` aceita só `[A-Za-z0-9-]`, para não quebrar a chave `USER#<sub>`.

## Erros

Toda resposta de erro segue o problem details (RFC 9457), com `Content-Type: application/problem+json`, e sai de um handler único (`app/errors.py`) para `HTTPException`, erro de validação e exceção não tratada:

```json
{
  "type": "about:blank",
  "title": "Unauthorized",
  "status": 401,
  "detail": "...",
  "requestId": "<id da requisição>"
}
```

- `detail` é opcional e some quando repetiria o `title`.
- No 422, `errors` lista só `loc` e `msg` de cada campo inválido. `input`, `ctx` e `url` ficam de fora, porque ecoariam o que o usuário enviou.
- O 401 do `auth.py` usa o mesmo formato.
- O 500 não tem `detail`: a mensagem da exceção nunca vai para o cliente.

## Logs

Uma linha JSON por registro, em stdout (`app/logs.py`). Campos fixos: `timestamp`, `level`, `logger`, `message` e `request_id`. Campos extras só entram se estiverem na allowlist `ALLOWED_FIELDS`: `method`, `route`, `status`, `duration_ms`, `error_type` e `stack`. Qualquer outro é descartado.

- Nunca vão para o log cabeçalhos, corpo, query string nem e-mail.
- `route` é o template da rota (`/designs/{design_id}`), nunca o path cru, que pode trazer dado pessoal. Sem rota casada (404), vale `<unmatched>`.
- O `RequestLogMiddleware` (ASGI puro, camada mais externa) grava uma linha `request` por requisição. O id vem do `aws_request_id` da Lambda, com `uuid4` de fallback.
- Toda exceção não tratada gera uma linha `app.error` (nível ERROR) no middleware, com `error_type` e `stack`. O `stack` traz só arquivo, linha e função de cada frame, sem a mensagem nem o texto da linha. Vale também para falha depois de a resposta começar.
- `exc_info` é sempre descartado, inclusive em `logger.exception` de bibliotecas.
- O mesmo id aparece como `requestId` no corpo do erro e como `request_id` no log: é a chave para correlacionar a resposta com o registro.
- O logger `mangum` fica em WARNING, para a linha de acesso ser só a do middleware.

## Lint de arquitetura

O `import-linter` (`uv run lint-imports`, contrato em `pyproject.toml`) proíbe que `app.*.router` importe `boto3`, `botocore` ou `anthropic` diretamente. Routers falam com services; só estes (ou repositórios) acessam AWS e a Claude API. O teste `tests/test_architecture.py` cobre o contrato.

## Por que Mangum

O Mangum adapta o evento do API Gateway (payload 2.0) para ASGI, então o FastAPI roda na Lambda sem mudanças e expõe o evento original em `scope["aws.event"]`, de onde `auth.py` lê os claims. Foi escolhido na #7 no lugar do AWS Lambda Web Adapter. O Web Adapter é mais bem mantido, mas é um binário em layer de outra conta AWS, fica fora do `uv.lock` e entrega o contexto do authorizer num cabeçalho. O Mangum é um único wheel com hash no lock. O risco dele é ter um só mantenedor ativo, e ele aparece só em `main.py` (`create_handler`) e em `auth.py`. A comparação completa está em `docs/handoff/7.md`. A Lambda usa `lifespan="off"`.
