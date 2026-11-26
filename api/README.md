# api — aws-cost-playground

API em Python + FastAPI + Pydantic v2, executada em AWS Lambda atrás do API Gateway HTTP API. Stack e decisões: `docs/architecture/aws-cost-playground/ADR-0001-stack.md`. Nível de arquitetura: `simple`.

As nove rotas do contrato estão declaradas, com corpo e resposta validados. Todas estão implementadas: designs (#53 e #54), `GET /quota` (#60), `DELETE /me` (#55) e `POST /estimates` (#62) (seção Rotas). O OpenAPI (`/docs`, `/redoc`, `/openapi.json`) está desligado.

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

Os testes usam `moto` para o DynamoDB; não precisam de credenciais AWS. Os do Cognito usam `botocore.stub.Stubber` e dublês em memória, porque o backend `cognito-idp` do moto exige `joserfc`, que não está no lock. Os de quota usam também um dublê em memória do DynamoDB, para simular falhas e concorrência.

## Variáveis de ambiente

| Variável | Obrigatória | Descrição |
|---|---|---|
| `TABLE_NAME` | sim | Nome da tabela única do DynamoDB (3 a 255 caracteres). Sem ela, a função falha ao iniciar. |
| `USER_POOL_ID` | não | ID do User Pool do Cognito (`<região>_<id>`). Só a função `api` a recebe. Sem ela, `DELETE /me` responde 503 e não apaga nada. |
| `LOG_LEVEL` | não | `DEBUG`, `INFO` (padrão), `WARNING` ou `ERROR`. Vale só para os loggers `app.*`. |
| `LLM_ENABLED` | não | Booleano, padrão `false`. Falha fechada: sem ela nenhuma estimativa é autorizada. Valor fora de booleano impede a função de subir. |
| `LLM_MODEL` | não | Id do modelo da Claude API: `claude-` seguido de 1 a 60 caracteres entre `a-z`, `0-9` e `-` (padrão `claude-haiku-5-5`). Trocar o modelo muda o custo por chamada: é decisão de custo do autor (ADR). |
| `ANTHROPIC_API_KEY_PARAMETER` | não | NOME do parâmetro do SSM que guarda a chave da Anthropic, nunca o valor: começa com `/` e tem até 255 caracteres entre letras, dígitos, `/`, `_`, `.` e `-`. Sem ele, a estimativa falha com `unavailable`. |
| `QUOTA_USER_DAILY_LIMIT` | não | Estimativas por usuário por dia: inteiro de 1 a 100 (padrão 20). |
| `QUOTA_GLOBAL_DAILY_LIMIT` | não | Estimativas por dia somando todos os usuários: inteiro de 1 a 1.000 (padrão 300). |

Os tetos 100 e 1.000 estão no código (`MAX_QUOTA_USER_DAILY_LIMIT`, `MAX_QUOTA_GLOBAL_DAILY_LIMIT`): valor fora da faixa impede a função de subir. Mudar o valor de uma quota é decisão de custo do autor (ADR). O Terraform ainda não define as variáveis de quota, então valem os padrões.

Nenhum segredo vai em código nem em variável commitada.

## Estrutura de `app/`

- `main.py` — composition root: `create_app()` e o `handler` da Lambda.
- `config.py` — `Settings`, lidas só do ambiente.
- `auth.py` — identidade do usuário.
- `routing.py` — `ProtectedRoute`, a `route_class` dos quatro routers: confere a identidade e o teto do corpo cru (`MAX_BODY_BYTES`, 1 MiB) antes de o FastAPI ler o corpo.
- `errors.py` — erros no formato problem details (`install_error_handlers`) e `ProblemError`, uma `HTTPException` com campos de extensão (o `scope` e o `resetsAt` do 429 de quota).
- `logs.py` — logs JSON, id da requisição e `RequestLogMiddleware`.
- `dynamo.py` — acesso à tabela única (`get_table()`).
- `design_document.py` — modelos Pydantic do documento do design, equivalentes ao schema zod do `web/`.
- `contracts.py` — leitor de `contracts/blocks.json` e `contracts/edges.json` (`load_contracts()`, `get_contracts()`).
- `designs/`, `estimates/`, `quotas/`, `account/` — um pacote por funcionalidade. `designs/` segue `router` → `service` → `repository`, com `schemas.py` (entradas e saídas) e `errors.py` (`DesignError` e subclasses, com status e `detail` fixos). A `DesignRoute`, em `designs/router.py`, converte `DesignError` em problem details. `quotas/` e `account/` também seguem `router` → `service.py` → `repository.py` (`account/` sem schemas; o `service.py` dele tem a ordem da exclusão e o Cognito). `estimates/` tem `router.py`, `service.py` e `schemas.py`, sem repositório próprio (usa o serviço de `quotas/` e o `claude_client.py`).
- `estimates/prompt.py` — system prompt fixo, JSON Schema da saída e `build_plan()`, que monta a mensagem para a LLM. Puro: sem rede, SDK nem AWS.
- `estimates/revalidation.py` — `revalidate()`, que trata a saída da LLM como entrada hostil e monta o resultado do zero. Puro.
- `estimates/claude_client.py` — `ClaudeClient` (`prepare()` e `estimate()`), `EstimateError`, `UsageEstimate` e `get_claude_client()`. Único ponto que chama o SSM e a Claude API.
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

Não há variável de ambiente nem cópia dos JSON dentro de `api/`. Por isso **o zip precisa levar `contracts/blocks.json` e `contracts/edges.json` na raiz, ao lado de `app/`**. O `scripts/build-functions.sh` da #22 (PR #218) hoje copia só `app/` e as dependências: enquanto ele não copiar `contracts/`, `get_contracts()` levanta `RuntimeError` na Lambda (falha fechada: arquivo ausente, cortado ou fora do contrato nunca vira contrato vazio). `POST /estimates` (#62) é a primeira rota que depende de `get_contracts()`.

## Estimativa de uso: pedido e revalidação

`estimates/prompt.py` e `estimates/revalidation.py` preparam a chamada à Claude API e conferem a resposta. O cliente que faz a chamada está em `claude_client.py` (próxima subseção). A rota `POST /estimates` liga os dois ao cliente (seção Rota de estimativa).

**O que vai para a LLM.** O `SYSTEM_PROMPT` constante e uma mensagem com duas seções: `<usage_catalog>` (dado confiável, de `contracts/`: chaves de uso com unidade, mínimo, máximo e se é inteiro) e `<input_data>` (dado do usuário: descrição, blocos com tipo e atributos, arestas). Blocos e arestas são citados pela posição `n`, nunca pelo id. Não vão região, rótulo, nome do design, `sub` nem e-mail. Atributo só vai se a chave e o valor forem do contrato; bloco de tipo fora do contrato não vai. O JSON sai compacto, com `<` e `>` escapados, para o texto do usuário não fechar o delimitador. `MAX_TOKENS` fixa o teto da saída em 4.096.

**Saída pedida** (`output_schema()`): `key` é um `enum` com as chaves do contrato, `value` é número e não há campo de texto livre.

```json
{"blocks": [{"n": 0, "values": [{"key": "requestsPerMonth", "value": 1200000}]}],
 "edges":  [{"n": 0, "values": [{"key": "gbPerMonth", "value": 12.5}]}]}
```

**Revalidação** (`revalidate()` devolve um `ItemUsage(id, values, source)` por bloco e por aresta, na ordem de entrada):

- `n` fora do diagrama, não inteiro ou booleano: item descartado.
- Chave que o tipo do bloco ou o kind da aresta não aceita: descartada.
- Valor que não é número (inclui booleano, `NaN` e infinito): descartado, e a chave recebe o padrão do contrato.
- Número fora da faixa: limitado a `min`/`max`; chave inteira é arredondada depois do limite.
- Chave ou `n` repetido: vale a primeira ocorrência.
- `source` é `llm` se ao menos um valor do item foi aceito; senão `default`, com todos os padrões.
- Raiz fora de `{"blocks": [...], "edges": [...]}`: `ValueError`, e nada da resposta é usado.

Nenhum texto livre da LLM chega ao resultado: ele só tem ids do diagrama, chaves do contrato e números dentro da faixa.

### Cliente da Claude API

`get_claude_client()` devolve o `ClaudeClient` do processo, configurado por `LLM_ENABLED`, `LLM_MODEL` e `ANTHROPIC_API_KEY_PARAMETER`. O uso tem dois passos:

1. `prepare(body)` roda antes de consumir quota: confere o interruptor e o tamanho e devolve um `EstimatePlan`. Não lê a chave nem usa a rede.
2. `estimate(plan)` roda depois da quota: faz uma chamada à API e devolve um `UsageEstimate` (`blocks` e `edges` revalidados, mais `input_tokens` e `output_tokens`). Plano sem nada a estimar (só padrões) volta sem chamada e sem custo.

Toda falha é um `EstimateError` com `code` e mensagem fixos; os tokens vêm preenchidos quando a chamada foi paga.

| `code` | Quando |
|---|---|
| `disabled` | `LLM_ENABLED=false` (em `prepare`). |
| `too_large` | O diagrama não vira plano, ou a saída esperada passa de `MAX_TOKENS` (em `prepare`). |
| `unavailable` | Parâmetro do SSM sem nome, ausente ou ilegível; chave vazia; falha de conexão; 400, 401, 402, 403, 404 ou 413 da API. |
| `timeout` | A API não respondeu no prazo. |
| `rate_limited` | 429 da API. |
| `overloaded` | 5xx da API, inclusive 529. |
| `refused` | A LLM recusou (`stop_reason` `refusal`). |
| `truncated` | A saída bateu em `max_tokens`; resposta parcial nunca é usada. |
| `invalid_output` | Outro `stop_reason` que não `end_turn`, ou saída que não é JSON ou não passa na revalidação. |

- **Chamada.** Modelo de `LLM_MODEL`, `max_tokens` 4.096, thinking desligado, esforço `low` e saída em `json_schema`.
- **Prazo.** `LLM_TIMEOUT`: 20 s de leitura e 3 s de conexão, abaixo dos 29 s da Lambda, que ainda precisa do início a frio, do SSM (até 5 s) e da quota.
- **Sem nova tentativa.** `LLM_MAX_RETRIES=0` (o padrão do SDK é 2): uma segunda chamada depois de um timeout não cabe nos 29 s, e repetir sozinho multiplicaria o custo de uma estimativa que já consumiu quota.
- **Chave.** Lida do SSM com `WithDecryption` na primeira chamada de cada execução fria e mantida só dentro do cliente do SDK. Um 401 descarta o cliente, e a chamada seguinte relê o SSM (chave trocada ou revogada). A chave não aparece em log, erro nem `repr`.
- **Log.** Cada falha grava só `llm estimate failed` (WARNING) com `error_type` igual ao `code`: nada da descrição, do diagrama, da AWS nem da Anthropic.

### Rota de estimativa

`POST /estimates` (`estimates/service.py`, `estimate_usage`) é onde o teto de gasto com a LLM é aplicado. Ordem: 401 → 413 (corpo) → 422 (`ProtectedRoute` e Pydantic) → `prepare` (interruptor e tamanho, sem rede) → `consume` (quota) → `estimate` (uma chamada, sem nova tentativa).

- Entrada inválida e interruptor desligado não consomem quota.
- Quota recusada ou indisponível nunca chama a LLM.
- Falha da LLM depois do consumo NÃO devolve a quota: devolver abriria repetição gratuita, bastaria provocar a falha.

**Resposta 200.** `blocks` e `edges` trazem `{id, values, source}`, com os ids do pedido na ordem de entrada. `source` é `llm` ou `default` e é calculado na API. O `web/` ainda não lê `source` (o zod descarta). `quota` é `{limit, remaining, resetsAt}`.

```json
{"blocks": [{"id": "blk_fn", "values": {"requestsPerMonth": 1200000}, "source": "llm"}],
 "edges":  [{"id": "edg_out", "values": {"gbPerMonth": 10}, "source": "default"}],
 "quota":  {"limit": 20, "remaining": 19, "resetsAt": "2026-11-27T00:00:00Z"}}
```

**Erros.** `detail` é fixo por status; nada da LLM, da Anthropic ou da AWS chega ao cliente. O cliente do `web/` lê só o status: 413 vira `too-large`, 502 e 503 viram `unavailable`, 429 vira `quota-exhausted`.

| Código ou causa | Status |
|---|---|
| `too_large` | 413 |
| `disabled`, `unavailable` | 503 |
| `timeout`, `rate_limited`, `overloaded` | 503 com `Retry-After: 30` |
| `refused`, `truncated`, `invalid_output` | 502 |
| Quota esgotada | 429 com `scope` e `resetsAt` |
| Quota indisponível | 503 |

**Log.** O logger `app.estimate` grava um evento por chamada: `estimate completed` (INFO), `estimate rejected` (WARNING: recusada antes da LLM, inclusive pela quota; `result` `quota_unavailable` pode ter consumido, se a leitura do restante falhou depois do incremento) e `estimate failed after quota consumed` (ERROR). Campos: `result`, `duration_ms`, `input_tokens`, `output_tokens`, `block_count`, `edge_count`, `sub` e `request_id`. Nunca vão descrição, ids, rótulos nem e-mail.

## Rotas

Mesmo mapa do adaptador do cliente (`web/src/shared/lib/http/httpApi.ts`). Corpo em camelCase; `design_id` é ULID (fora do formato: 422). Todas exigem identidade e estão implementadas.

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
| `DELETE /me` | — | 204 | #55 |

- `PATCH` exige ao menos um entre `name` e `doc` e recusa `null` explícito nos dois: omita a chave para não alterar.
- 409 `Design limit reached` (`design-limit` no cliente) em `POST /designs` e em duplicate; 409 `Version conflict` (`version-conflict`) no `PATCH`. Nos dois casos, nada fica gravado.
- `PATCH`: 404 se o design não existe na partição do usuário (também quando é de outro usuário), sem criar item; 409 se `expectedVersion` não é a `version` gravada. Renomear é mandar só `name`. Na resposta, `version` avança 1 e `updatedAt` muda; `createdAt` fica.
- Duplicate: 404 se a origem não existe na partição do usuário, conferido antes do limite de 50. A cópia tem id novo, `version` 1, datas novas e o `doc` da origem.
- `DELETE /designs/{design_id}`: 204 sem corpo e idempotente, também para id inexistente ou de outro usuário (nada é apagado fora da partição do `sub`).
- `DELETE /me`: 204 sem corpo; 401 sem `sub` ou `username` válido; 503 `Account deletion incomplete, retry` com `Retry-After: 5`. Detalhes em "Exclusão de conta".
- As rotas de designs ainda não estão no API Gateway (`infra/envs/*/main.tf`): é outra Issue.

Ordem das respostas: 401 (sem `sub`) → 413 (corpo cru acima de 1 MiB, ou `doc` acima de 350.000 bytes) → 400 (JSON que o parser recusa, como inteiro com mais de 4.300 dígitos ou aninhamento extremo) / 422 (validação) → handler (resposta da rota). A `ProtectedRoute` garante que o 401 saia sem olhar o corpo e que o 413 do corpo cru saia antes de o JSON ser decodificado. O limite de 350.000 bytes do `doc` é medido depois do parse completo do documento (sem as chaves desconhecidas) e tem precedência sobre o 422: se algum erro de validação for `doc_too_large`, a resposta é 413 mesmo que haja outros campos inválidos.

## Designs no DynamoDB

Item na tabela única (`app/designs/repository.py`):

- `PK = USER#<sub>`, `SK = DESIGN#<ulid>`. O `id` do design vem da `SK`: não há atributo `id`. Não há `ttl`.
- Atributos: `name`, `region`, `schemaVersion`, `blockCount`, `sizeBytes`, `createdAt`, `updatedAt`, `version` e `doc` (JSON compacto, em string).
- O id é um ULID gerado no servidor: 48 bits de tempo e 80 bits de `secrets`. Datas em UTC, com milissegundos e `Z`.
- Leituras usam `ConsistentRead`. A listagem é uma `Query` com `begins_with(SK, "DESIGN#")` e projeção sem `doc`, que percorre todas as páginas e ordena por `updatedAt` decrescente e depois `id` decrescente, com no máximo 50 resumos.
- Só `GetItem`, `PutItem`, `UpdateItem`, `DeleteItem` e `Query`, as ações da política do papel da função (`UpdateItem` entrou com a #54). Nunca `Scan`.
- Design de outro usuário responde 404, igual a inexistente: a chave sempre leva o `sub` do JWT.

**Limite de 50 designs por usuário.** Sem transação, `POST /designs` (e o duplicate, pelo mesmo caminho) conta (`Query` com `Select=COUNT`), grava com `attribute_not_exists(PK)`, conta de novo e, se passou de 50, apaga o que gravou e responde 409. Se a recontagem falhar, também apaga e devolve o erro (o cliente não recebeu o id). Duas criações simultâneas no limite podem ser ambas recusadas, nunca ambas aceitas. Resíduo: se a função morrer entre a gravação e a remoção, ou se a remoção falhar, pode sobrar 1 item acima do limite; a listagem continua devolvendo no máximo 50.

**Trava otimista.** O `PATCH` é um único `UpdateItem` com `ConditionExpression` `attribute_exists(PK) AND version = :esperada`, sem leitura antes (ADR-0001). Na recusa, o item antigo devolvido pela condição (`ReturnValuesOnConditionCheckFailure`) só decide entre 409 (existe, versão outra) e 404 (não existe); `attribute_exists(PK)` impede que o `UpdateItem` crie item. Os nomes de atributo vêm do serviço, nunca do corpo, e `PK`, `SK` e `version` não podem ser alterados por ele.

```http
PATCH /designs/01JD0000000000000000000000
Content-Type: application/json

{"expectedVersion": 3, "name": "API de pedidos"}
```

Com `version` 3 gravada: 200 com o design e `"version": 4`. Com outra versão gravada (outra aba salvou antes):

```http
HTTP/1.1 409 Conflict
Content-Type: application/problem+json

{"type": "about:blank", "title": "Conflict", "status": 409, "detail": "Version conflict", "requestId": "<id da requisição>"}
```

**Custo de leitura.** `Select=COUNT` e a projeção não reduzem a leitura cobrada: o DynamoDB cobra os itens inteiros, com o `doc`. Uma partição cheia (50 designs de 350 KB) custa cerca de 4.400 unidades de leitura por listagem ou contagem. Separar o `doc` dos metadados ou limitar a taxa por usuário é decisão de ADR (#277).

**Falhas.** Item gravado que não passa no schema de saída responde 500 sem detalhe e registra `error_type: CorruptedItem`. Falha do DynamoDB responde 503 (throttling, indisponibilidade, rede) ou 500 (o resto), nunca com texto da AWS, e grava uma linha de log `app.designs` só com o código do erro em `error_type`.

## Identidade

A identidade vem só do claim `sub` do JWT, já validado pelo authorizer do API Gateway. `app/auth.py` é o único ponto que a lê (`CurrentUserId`, dependência do FastAPI), a partir do evento da Lambda; a API não lê o token nem cabeçalhos. Sem `sub` válido, responde 401. O `sub` aceita só `[A-Za-z0-9-]`, para não quebrar a chave `USER#<sub>`.

## Exclusão de conta

`DELETE /me` apaga quem chama. Não lê corpo, query nem caminho: o alvo vem só dos claims do JWT já validado pelo API Gateway. `sub` define a partição `USER#<sub>`; `username` (claim do access token) é o `Username` do `AdminDeleteUser`. O pool usa `username_attributes = ["email"]`, então o `Username` é o UUID gerado pelo Cognito, nunca o e-mail. Sem `username` válido: 401 e nada é apagado.

Ordem (ADR-0001):

1. **Dados.** `Query` paginada com leitura consistente (só `SK`) e `BatchWriteItem` em lotes de 25. `UnprocessedItems` é reenviado até 3 envios por lote, com espera exponencial (0,1 s e 0,2 s). Até 3 voltas de consulta + exclusão e uma conferência final; se sobrar item, 503 e o Cognito **não** é chamado.
2. **Cognito.** `AdminDeleteUser`; `UserNotFoundException` conta como sucesso.

Repetir a chamada após qualquer falha termina o trabalho (idempotente). IAM da função `api`: só `dynamodb:Query`, `dynamodb:BatchWriteItem` (com `LeadingKeys` `USER#*`) e `cognito-idp:AdminDeleteUser`; nunca `Scan`. Sem `USER_POOL_ID`, falha antes de apagar qualquer dado.

**Apaga:** todos os itens de `USER#<sub>` (designs `DESIGN#<ulid>` e contadores `QUOTA#<aaaa-mm-dd>`) e o usuário no Cognito (com ele, o e-mail e os refresh tokens).

**Não apaga:** a quota global (`PK = GLOBAL`, que não é do usuário e o papel da `api` não alcança); backups de recuperação pontual (PITR, só em produção; 35 dias, o padrão do DynamoDB, já que `infra/modules/database` não define outro período; o dado apagado continua recuperável nessa janela e some sozinho ao fim dela); logs do CloudWatch até a retenção de 7 dias (o log da aplicação não tem e-mail; o evento de exclusão não leva `sub`, mas os eventos de quota e de estimativa do `llm-proxy` levam o `sub`, pseudônimo; o log de acesso do API Gateway registra o `sub`, pseudônimo, em toda requisição, inclusive nesta); o que já foi enviado à Anthropic nas estimativas.

**Tempo no pior caso:** 50 designs de até 350 KB (cerca de 17,5 MB, 18 páginas de `Query`) mais até 35 contadores: cerca de 85 itens, 4 lotes e 22 chamadas por volta, normalmente bem abaixo de 1 a 2 s. As esperas de reenvio somam menos de 2 s. Se a Lambda estourar os 10 s, o cliente repete.

**Token ainda válido (risco residual, decisão pendente do autor).** O access token vale até 15 min após a exclusão: o authorizer valida só assinatura e expiração (os refresh tokens morrem com o usuário). Nesse intervalo, leituras voltam vazias, mas uma escrita (criar design, ou estimativa que incrementa a quota) recria itens em `USER#<sub>` de um usuário que não existe mais. Contadores somem pelo `ttl` de 35 dias; designs órfãos não têm `ttl`. Não há revogação de token (exigiria custo ou infra nova). Mitigação: o cliente encerra a sessão e descarta os tokens logo após o 204 (#58).

**Log.** Sucesso: logger `app.account`, mensagem `account deleted`, com `request_id` e `deleted_items`. Falha: `account deletion incomplete` com `stage` (`config`, `data` ou `identity`) e `error_type` (código do erro da AWS ou nome da classe, nunca a mensagem). Sem `sub`, `username`, e-mail nem hash derivado: a correlação é só pelo `request_id`, que também vai no `requestId` do 503. Runbook: `docs/runbooks/exclusao-de-conta.md`.

## Quotas

Teto de gasto com a LLM (ADR, ameaça T1). Código em `app/quotas/`: `repository.py` fala com o DynamoDB e `service.py` aplica as regras. `consume(sub)` e `read(sub)` devolvem `QuotaOut`.

- **Itens.** `USER#<sub>` / `QUOTA#<aaaa-mm-dd>` e `GLOBAL` / `QUOTA#<aaaa-mm-dd>`, com os atributos `count` e `ttl`. O dia é em UTC, pelo relógio do servidor. O `ttl` é o instante do primeiro consumo do dia mais 35 dias, gravado por `if_not_exists`.
- **Consumo.** Uma única `TransactWriteItems` com dois `Update` (`SET #ttl = if_not_exists(#ttl, :ttl) ADD #count :one`), cada um com a condição `attribute_not_exists(#count) OR #count < :limit`. Não há leitura antes da escrita. Estourar um contador não consome o outro.
- **429.** Problem details com `scope` (`user` ou `global`) e `resetsAt` (próxima meia-noite UTC, `aaaa-mm-ddT00:00:00Z`), sem `detail`. Com os dois contadores estourados, o `scope` é `user` (igual ao fake do `web/`).
- **Falha fechada (503 sem detalhe).** `LLM_ENABLED=false`, erro do DynamoDB, `CancellationReasons` ambíguo (por exemplo `TransactionConflict`), resposta inesperada e `sub` fora do formato.
- **Ordem.** A quota é consumida antes da LLM e não é devolvida se ela falhar. Se a leitura do restante falhar depois do incremento, a quota fica consumida e a resposta é 503.
- **`GET /quota`.** Lê só o item do próprio usuário com `GetItem` consistente. Não consome e não reflete a quota global.
- **IAM.** O papel do `llm-proxy` só tem `dynamodb:GetItem` e `dynamodb:UpdateItem`. A transação só com `Update` é autorizada por `UpdateItem`: ["Permissions for Put, Update, Delete, and Get actions are governed by the permissions used for the underlying PutItem, UpdateItem, DeleteItem, and GetItem operations"](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis-iam.html).

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
- O 404 vale para design inexistente ou de outro usuário. O 409 de `design-limit` traz `detail` "Design limit reached". O 503 indica falha transitória do DynamoDB (vale tentar de novo) e não tem `detail`.
- O 500 não tem `detail`: a mensagem da exceção nunca vai para o cliente.
- `ProblemError` acrescenta campos de extensão ao corpo. O 429 de quota traz `scope` (`user` ou `global`) e `resetsAt`, sem `detail` (seção Quotas).

## Logs

Uma linha JSON por registro, em stdout (`app/logs.py`). Campos fixos: `timestamp`, `level`, `logger`, `message` e `request_id`. Campos extras só entram se estiverem na allowlist `ALLOWED_FIELDS`: `method`, `route`, `status`, `duration_ms`, `error_type`, `stack`, `stage`, `deleted_items`, `scope`, `count`, `limit`, `sub`, `result`, `input_tokens`, `output_tokens`, `block_count` e `edge_count`. Qualquer outro é descartado.

- Nunca vão para o log cabeçalhos, corpo, query string nem e-mail.
- `route` é o template da rota (`/designs/{design_id}`), nunca o path cru, que pode trazer dado pessoal. Sem rota casada (404), vale `<unmatched>`.
- O `RequestLogMiddleware` (ASGI puro, camada mais externa) grava uma linha `request` por requisição. O id vem do `aws_request_id` da Lambda, com `uuid4` de fallback.
- Toda exceção não tratada gera uma linha `app.error` (nível ERROR) no middleware, com `error_type` e `stack`. O `stack` traz só arquivo, linha e função de cada frame, sem a mensagem nem o texto da linha. Vale também para falha depois de a resposta começar.
- `exc_info` é sempre descartado, inclusive em `logger.exception` de bibliotecas.
- O mesmo id aparece como `requestId` no corpo do erro e como `request_id` no log: é a chave para correlacionar a resposta com o registro.
- O logger `app.quota` grava `quota consumed` (INFO), `quota exhausted` (WARNING) e `quota unavailable`, `quota read failed` e `llm disabled` (ERROR, com `error_type`). O `sub` aparece só nesses eventos de quota; e-mail nunca.
- O `LOG_LEVEL` vale só para os loggers `app.*`. As bibliotecas (botocore, httpx, anthropic, mangum) ficam em WARNING: em DEBUG elas registrariam cabeçalhos assinados e corpos de requisição. A linha de acesso é só a do middleware.

## Lint de arquitetura

O `import-linter` (`uv run lint-imports`, contrato em `pyproject.toml`) proíbe que `app.*.router` importe `boto3`, `botocore` ou `anthropic` diretamente. Routers falam com services; só estes (ou repositórios) acessam AWS e a Claude API. O teste `tests/test_architecture.py` cobre o contrato.

## Por que Mangum

O Mangum adapta o evento do API Gateway (payload 2.0) para ASGI, então o FastAPI roda na Lambda sem mudanças e expõe o evento original em `scope["aws.event"]`, de onde `auth.py` lê os claims. Foi escolhido na #7 no lugar do AWS Lambda Web Adapter. O Web Adapter é mais bem mantido, mas é um binário em layer de outra conta AWS, fica fora do `uv.lock` e entrega o contexto do authorizer num cabeçalho. O Mangum é um único wheel com hash no lock. O risco dele é ter um só mantenedor ativo, e ele aparece só em `main.py` (`create_handler`) e em `auth.py`. A comparação completa está em `docs/handoff/7.md`. A Lambda usa `lifespan="off"`.
