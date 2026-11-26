# api — aws-cost-playground

API em Python + FastAPI + Pydantic v2, executada em AWS Lambda atrás do API Gateway HTTP API. Stack e decisões: `docs/architecture/aws-cost-playground/ADR-0001-stack.md`. Nível de arquitetura: `simple`.

As nove rotas do contrato estão declaradas, com corpo e resposta validados. `DELETE /me` está implementada (#55); as outras oito respondem 501 até as Issues de cada uma (seção Rotas). O OpenAPI (`/docs`, `/redoc`, `/openapi.json`) está desligado.

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

Os testes usam `moto` para o DynamoDB; não precisam de credenciais AWS. Os do Cognito usam `botocore.stub.Stubber` e dublês em memória, porque o backend `cognito-idp` do moto exige `joserfc`, que não está no lock.

## Variáveis de ambiente

| Variável | Obrigatória | Descrição |
|---|---|---|
| `TABLE_NAME` | sim | Nome da tabela única do DynamoDB (3 a 255 caracteres). Sem ela, a função falha ao iniciar. |
| `USER_POOL_ID` | não | ID do User Pool do Cognito (`<região>_<id>`). Só a função `api` a recebe. Sem ela, `DELETE /me` responde 503 e não apaga nada. |
| `LOG_LEVEL` | não | `DEBUG`, `INFO` (padrão), `WARNING` ou `ERROR`. Vale só para os loggers `app.*`. |

Nenhum segredo vai em código nem em variável commitada.

## Estrutura de `app/`

- `main.py` — composition root: `create_app()` e o `handler` da Lambda.
- `config.py` — `Settings`, lidas só do ambiente.
- `auth.py` — identidade do usuário.
- `routing.py` — `ProtectedRoute`, a `route_class` dos quatro routers: confere a identidade e o teto do corpo cru (`MAX_BODY_BYTES`, 1 MiB) antes de o FastAPI ler o corpo.
- `errors.py` — erros no formato problem details (`install_error_handlers`).
- `logs.py` — logs JSON, id da requisição e `RequestLogMiddleware`.
- `dynamo.py` — acesso à tabela única (`get_table()`).
- `design_document.py` — modelos Pydantic do documento do design, equivalentes ao schema zod do `web/`.
- `contracts.py` — leitor de `contracts/blocks.json` e `contracts/edges.json` (`load_contracts()`, `get_contracts()`).
- `designs/`, `estimates/`, `quotas/`, `account/` — um pacote por funcionalidade. `designs/`, `estimates/` e `quotas/` têm só `router.py` (handlers que respondem 501) e `schemas.py`; seguirão `router` → `service` → repositório quando as rotas forem implementadas. `account/` já segue o formato: `router.py`, `service.py` (ordem da exclusão, Cognito) e `repository.py` (DynamoDB); não tem schemas.
- `designs/schemas.py` também guarda `MAX_DOC_BYTES` (350.000) e `doc_size_bytes()`, que mede o `doc` em bytes UTF-8 do JSON compacto.

## Documento do design e contratos

`app/design_document.py` valida o documento do design com as mesmas regras do `designDocumentSchema` (`web/src/shared/lib/design/designDocument.ts`), que é a fonte da verdade. Os dois lados leem os exemplos de `contracts/examples/design/{valid,invalid}/` e precisam dar o mesmo veredito: `tests/test_design_document.py` aqui e `designExamples.test.ts` no `web/`. Uma divergência quebra um dos testes.

`app/contracts.py` lê `contracts/blocks.json` e `contracts/edges.json`, os mesmos arquivos do `web/` (`docs/architecture/aws-cost-playground/block-contract.md`). `get_contracts()` carrega na primeira chamada e guarda o resultado em cache; `load_contracts(directory)` lê de uma pasta explícita. Contrato inválido levanta `ValidationError`; sem `blocks.json`, `RuntimeError`. A pasta `contracts/` é procurada em `/var/task/contracts` (zip da Lambda) e, depois, na raiz do repositório.

- **Leitura tolerante.** Chave desconhecida no documento é descartada, não recusada, para permitir rollback entre builds.
- **Tipos estritos.** Nada é convertido: `"1"` não vira `1`, `true` não vira `1`, `1` não vira texto. Como no JS, `1.0` e `1` são o mesmo número. Texto é medido em pontos de código (um emoji vale 1), como no zod 4.
- **Chave repetida no JSON.** Vale a última ocorrência, nos dois lados (`JSON.parse`, `json.loads` e o `model_validate_json`).
- **Divergências conhecidas** (nenhuma pode ter exemplo compartilhado, porque os lados discordam ou o arquivo nem é JSON):
  - Substituto UTF-16 solto em texto (`"\ud800"`): a API recusa (não é serializável em UTF-8), o zod aceita.
  - `NaN` e `Infinity` escritos no JSON: o `JSON.parse` recusa o arquivo; o `json.loads` lê e o modelo recusa. Os dois lados dão inválido. Número que estoura o float64 (`1e400`) tem exemplo e é recusado nos dois.
  - Número de 1e-6 até antes de 1e-5: o Pydantic escreve `1e-6`, o JS escreve `0.000001`. O `sizeBytes` do documento muda em poucos bytes conforme o lado que serializa. Os demais números (inteiros, `-0`, expoentes grandes) saem com o mesmo tamanho.
  - A lista de erros: o zod relata todos; a API para no primeiro bloco e na primeira aresta inválidos (`fail_fast`). O veredito é o mesmo.

### Como a Lambda enxerga `contracts/`

`app/contracts.py` não recebe caminho de fora: procura `contracts/` em dois lugares fixos, calculados a partir do próprio arquivo, nesta ordem:

1. ao lado de `app/` — no zip da Lambda, `/var/task/contracts/`;
2. um nível acima — a raiz do repositório, no desenvolvimento e nos testes (`api/app/contracts.py` → `contracts/`).

Não há variável de ambiente nem cópia dos JSON dentro de `api/`. Por isso **o zip precisa levar `contracts/blocks.json` e `contracts/edges.json` na raiz, ao lado de `app/`**. O `scripts/build-functions.sh` (#22, PR #218) copia esses dois arquivos, e só eles, para `contracts/` na raiz do zip (#242); exemplos e cenários ficam de fora, e arquivo ausente derruba o build. `api/tests/test_package.py` trava isso: roda o script e confere o conteúdo do zip e que `app.contracts` carrega do pacote extraído. Se o zip sair sem eles, `get_contracts()` levanta `RuntimeError` na Lambda (falha fechada: arquivo ausente, cortado ou fora do contrato nunca vira contrato vazio). Nenhuma rota chama `get_contracts()` ainda; as primeiras são as de estimativa (#61, #62).

## Rotas

Mesmo mapa do adaptador do cliente (`web/src/shared/lib/http/httpApi.ts`). Corpo em camelCase; `design_id` é ULID (fora do formato: 422). Todas exigem identidade; as não implementadas respondem 501 em problem details.

| Método e caminho | Corpo | Sucesso | Issue |
|---|---|---|---|
| `GET /designs` | — | 200, array de resumos | #53 |
| `POST /designs` | `{name, doc}` | 201, design | #53 |
| `GET /designs/{design_id}` | — | 200, design | #53 |
| `PATCH /designs/{design_id}` | `{expectedVersion, name?, doc?}` | 200, design | #54 |
| `DELETE /designs/{design_id}` | — | 204 | #54 |
| `POST /designs/{design_id}/duplicate` | `{name}` | 201, design | #54 |
| `POST /estimates` | `{region, description, blocks, edges}` | 200, estimativa | #62 |
| `GET /quota` | — | 200, quota | #60 |
| `DELETE /me` | — | 204 (implementada) | #55 |

- `PATCH` exige ao menos um entre `name` e `doc` e recusa `null` explícito nos dois: omita a chave para não alterar.
- Quando as rotas forem implementadas, 409 será `design-limit` em create/duplicate e `version-conflict` no update.
- `DELETE /me`: 204 sem corpo; 401 sem `sub` ou `username` válido; 503 `Account deletion incomplete, retry` com `Retry-After: 5`. Detalhes em "Exclusão de conta".
- As rotas de designs ainda não estão no API Gateway (`infra/envs/*/main.tf`): é outra Issue.

Ordem das respostas: 401 (sem `sub`) → 413 (corpo cru acima de 1 MiB, ou `doc` acima de 350.000 bytes) → 400 (JSON que o parser recusa, como inteiro com mais de 4.300 dígitos ou aninhamento extremo) / 422 (validação) → 501. A `ProtectedRoute` garante que o 401 saia sem olhar o corpo e que o 413 do corpo cru saia antes de o JSON ser decodificado. O limite de 350.000 bytes do `doc` é medido depois do parse completo do documento (sem as chaves desconhecidas) e tem precedência sobre o 422: se algum erro de validação for `doc_too_large`, a resposta é 413 mesmo que haja outros campos inválidos.

## Identidade

A identidade vem só do claim `sub` do JWT, já validado pelo authorizer do API Gateway. `app/auth.py` é o único ponto que a lê (`CurrentUserId`, dependência do FastAPI), a partir do evento da Lambda; a API não lê o token nem cabeçalhos. Sem `sub` válido, responde 401. O `sub` aceita só `[A-Za-z0-9-]`, para não quebrar a chave `USER#<sub>`.

## Exclusão de conta

`DELETE /me` apaga quem chama. Não lê corpo, query nem caminho: o alvo vem só dos claims do JWT já validado pelo API Gateway. `sub` define a partição `USER#<sub>`; `username` (claim do access token) é o `Username` do `AdminDeleteUser`. O pool usa `username_attributes = ["email"]`, então o `Username` é o UUID gerado pelo Cognito, nunca o e-mail. Sem `username` válido: 401 e nada é apagado.

Ordem (ADR-0001):

1. **Dados.** `Query` paginada com leitura consistente (só `SK`) e `BatchWriteItem` em lotes de 25. `UnprocessedItems` é reenviado até 3 envios por lote, com espera exponencial (0,1 s e 0,2 s). Até 3 voltas de consulta + exclusão e uma conferência final; se sobrar item, 503 e o Cognito **não** é chamado.
2. **Cognito.** `AdminDeleteUser`; `UserNotFoundException` conta como sucesso.

Repetir a chamada após qualquer falha termina o trabalho (idempotente). IAM da função `api`: só `dynamodb:Query`, `dynamodb:BatchWriteItem` (com `LeadingKeys` `USER#*`) e `cognito-idp:AdminDeleteUser`; nunca `Scan`. Sem `USER_POOL_ID`, falha antes de apagar qualquer dado.

**Apaga:** todos os itens de `USER#<sub>` (designs `DESIGN#<ulid>` e contadores `QUOTA#<aaaa-mm-dd>`) e o usuário no Cognito (com ele, o e-mail e os refresh tokens).

**Não apaga:** a quota global (`PK = GLOBAL`, que não é do usuário e o papel da `api` não alcança); backups de recuperação pontual (PITR, só em produção; 35 dias, o padrão do DynamoDB, já que `infra/modules/database` não define outro período; o dado apagado continua recuperável nessa janela e some sozinho ao fim dela); logs do CloudWatch até a retenção de 7 dias (o log da aplicação não tem e-mail nem `sub`; o log de acesso do API Gateway registra o `sub`, pseudônimo, em toda requisição, inclusive nesta); o que já foi enviado à Anthropic nas estimativas.

**Tempo no pior caso:** 50 designs de até 350 KB (cerca de 17,5 MB, 18 páginas de `Query`) mais até 35 contadores: cerca de 85 itens, 4 lotes e 22 chamadas por volta, normalmente bem abaixo de 1 a 2 s. As esperas de reenvio somam menos de 2 s. Se a Lambda estourar os 10 s, o cliente repete.

**Token ainda válido (risco residual, decisão pendente do autor).** O access token vale até 15 min após a exclusão: o authorizer valida só assinatura e expiração (os refresh tokens morrem com o usuário). Nesse intervalo, leituras voltam vazias, mas uma escrita (criar design, ou estimativa que incrementa a quota) recria itens em `USER#<sub>` de um usuário que não existe mais. Contadores somem pelo `ttl` de 35 dias; designs órfãos não têm `ttl`. Não há revogação de token (exigiria custo ou infra nova). Mitigação: o cliente encerra a sessão e descarta os tokens logo após o 204 (#58).

**Log.** Sucesso: logger `app.account`, mensagem `account deleted`, com `request_id` e `deleted_items`. Falha: `account deletion incomplete` com `stage` (`config`, `data` ou `identity`) e `error_type` (código do erro da AWS ou nome da classe, nunca a mensagem). Sem `sub`, `username`, e-mail nem hash derivado: a correlação é só pelo `request_id`, que também vai no `requestId` do 503. Runbook: `docs/runbooks/exclusao-de-conta.md`.

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
- O 413 vale para corpo cru acima de `MAX_BODY_BYTES` e para `doc` acima de `MAX_DOC_BYTES`; neste último caso não há lista `errors`.
- O 422 lista no máximo 20 erros (`MAX_REPORTED_ERRORS`) e trunca cada parte do `loc` em 40 caracteres (`MAX_LOC_PART_LENGTH`), porque o `loc` pode trazer chave enviada pelo usuário.
- O 401 do `auth.py` usa o mesmo formato.
- O 500 não tem `detail`: a mensagem da exceção nunca vai para o cliente.

## Logs

Uma linha JSON por registro, em stdout (`app/logs.py`). Campos fixos: `timestamp`, `level`, `logger`, `message` e `request_id`. Campos extras só entram se estiverem na allowlist `ALLOWED_FIELDS`: `method`, `route`, `status`, `duration_ms`, `error_type`, `stack`, `stage` e `deleted_items`. Qualquer outro é descartado.

- Nunca vão para o log cabeçalhos, corpo, query string nem e-mail.
- `route` é o template da rota (`/designs/{design_id}`), nunca o path cru, que pode trazer dado pessoal. Sem rota casada (404), vale `<unmatched>`.
- O `RequestLogMiddleware` (ASGI puro, camada mais externa) grava uma linha `request` por requisição. O id vem do `aws_request_id` da Lambda, com `uuid4` de fallback.
- Toda exceção não tratada gera uma linha `app.error` (nível ERROR) no middleware, com `error_type` e `stack`. O `stack` traz só arquivo, linha e função de cada frame, sem a mensagem nem o texto da linha. Vale também para falha depois de a resposta começar.
- `exc_info` é sempre descartado, inclusive em `logger.exception` de bibliotecas.
- O mesmo id aparece como `requestId` no corpo do erro e como `request_id` no log: é a chave para correlacionar a resposta com o registro.
- O `LOG_LEVEL` vale só para os loggers `app.*`. As bibliotecas (botocore, httpx, anthropic, mangum) ficam em WARNING: em DEBUG elas registrariam cabeçalhos assinados e corpos de requisição. A linha de acesso é só a do middleware.

## Lint de arquitetura

O `import-linter` (`uv run lint-imports`, contrato em `pyproject.toml`) proíbe que `app.*.router` importe `boto3`, `botocore` ou `anthropic` diretamente. Routers falam com services; só estes (ou repositórios) acessam AWS e a Claude API. O teste `tests/test_architecture.py` cobre o contrato.

## Por que Mangum

O Mangum adapta o evento do API Gateway (payload 2.0) para ASGI, então o FastAPI roda na Lambda sem mudanças e expõe o evento original em `scope["aws.event"]`, de onde `auth.py` lê os claims. Foi escolhido na #7 no lugar do AWS Lambda Web Adapter. O Web Adapter é mais bem mantido, mas é um binário em layer de outra conta AWS, fica fora do `uv.lock` e entrega o contexto do authorizer num cabeçalho. O Mangum é um único wheel com hash no lock. O risco dele é ter um só mantenedor ativo, e ele aparece só em `main.py` (`create_handler`) e em `auth.py`. A comparação completa está em `docs/handoff/7.md`. A Lambda usa `lifespan="off"`.
