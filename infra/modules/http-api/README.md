# Módulo `http-api`

API Gateway HTTP API na frente das duas Lambdas (`api` e `llm-proxy`), com authorizer JWT do Cognito em todas as rotas. É a parte 1 da #19 (#131); o domínio próprio chega na parte 2 (#132).

> Até a #132, o endpoint `execute-api` padrão fica ligado e é a única porta da API. Não use o módulo em `infra/envs` antes dela.

## O que cria

- API HTTP com CORS (lista explícita de origens).
- Authorizer JWT do Cognito, com identity source `$request.header.Authorization`.
- Duas integrações `AWS_PROXY` (payload 2.0, timeout de 30 s). O limite real é o da função, 10 s na `api` e 29 s no `llm-proxy`, definido no módulo `functions`.
- A permissão de invocação de cada função, restrita a esta API.
- Uma rota por entrada de `routes`, todas com o authorizer.
- Log group do log de acesso `/aws/vendedlogs/apigateway/<name_prefix>-http-api`, com retenção por variável.
- Stage `$default` com auto deploy, limite de taxa padrão e por rota.

## O que não cria

- Domínio próprio e o desligamento do endpoint `execute-api`: #132.
- Registro de alias no Route 53: módulo `dns` (#121).
- As funções: módulo `functions` (#18).
- Alarmes: #20.
- Uso nos ambientes: #21.

## Variáveis

| Nome | Tipo | Descrição |
|---|---|---|
| `name_prefix` | `string` | Prefixo do ambiente. Aceita só `acp-stg` ou `acp-prod`. |
| `function_names` | `object({ api, llm-proxy })` | Nome de cada função (saída `function_names` do módulo `functions`). As duas chaves são obrigatórias. |
| `function_invoke_arns` | `object({ api, llm-proxy })` | ARN de invocação de cada função (saída `function_invoke_arns` do módulo `functions`). |
| `jwt_issuer` | `string` | Emissor dos tokens (saída `issuer` do módulo `auth`). User Pool do Cognito em `us-east-1`, sem barra final. |
| `jwt_audience` | `list(string)` | Ids dos clientes do Cognito aceitos. Ao menos um. |
| `cors_allowed_origins` | `list(string)` | Origens do site no CORS. Ao menos uma `https://<host>`, sem `*`, caminho, porta nem barra final. |
| `routes` | `map(object)` | Rotas da API; ver "Rotas". `throttle` (`rate_limit`, `burst_limit`) é opcional. |
| `default_throttle` | `object` | Limite das rotas sem `throttle` próprio. Obrigatório, sem default. `rate_limit > 0` e `burst_limit` inteiro, no mínimo 1. |
| `log_retention_days` | `number` | Retenção do log de acesso. Default 7 (valor do ADR); aceita 1, 3, 5, 7, 14 ou 30. |

## Outputs

| Nome | Descrição |
|---|---|
| `api_id` | Id da API: dimensão `ApiId` dos alarmes e `<API_ID>` do runbook de guardrails. |
| `access_log_group_name` | Nome do log group do log de acesso, para conferir a retenção (runbook de guardrails, passo 6). |

## Rotas

- A chave de `routes` é o route key exato (`POST /estimates`). Só `GET`, `POST`, `PUT`, `PATCH` e `DELETE`, com caminho literal ou `{param}`.
- `$default`, `ANY`, `OPTIONS` e `{proxy+}` são rejeitados. Com `$default` e authorizer, o preflight de CORS cairia no authorizer, e a AWS manda criar uma rota `OPTIONS /{proxy+}` sem autorização, o que quebraria "nenhuma rota pública". Com método explícito, o próprio API Gateway responde o preflight, sem rota `OPTIONS`.
- Consequência: rota nova na `api/` só existe no gateway depois de entrar em `routes` nos dois ambientes (#21); sem isso a resposta é 404 (falha fechada). Remover ou renomear uma chave gera `delete` no plano e cai no plan-guard (`needs-human`).
- O destino sai do caminho, dentro do módulo: `/estimates` e `/quota` (e o que houver abaixo deles) vão para o `llm-proxy`; todo o resto vai para a `api`. `/estimates-export` vai para a `api`. Quem chama não escolhe.

## Limite de taxa

- `default_throttle` é obrigatório e sem default: o valor é do autor, por ambiente. O runbook `docs/runbooks/guardrails-de-custo.md` (passo 2) sugere 10 req/s e rajada 20 para as demais rotas, e 1 req/s e rajada 5 para `POST /estimates`.
- `throttle` por rota é opcional e vira `route_settings` com a mesma chave do map de rotas. Por construção não existe limite apontando para rota inexistente (uma chave diferente é aceita pela AWS e não tem efeito).
- O limite é da rota, não do usuário. Requisição acima dele recebe 429 sem invocar a Lambda.

## Log de acesso

Formato JSON fixo no módulo, só com variáveis `$context`: `requestId`, `requestTime`, `routeKey`, `status`, `protocol`, `responseLength`, `responseLatency`, `integrationLatency`, `integrationError`, `authorizerError`, `errorMessage` e `sub`.

- Guarda o claim `sub` (pseudônimo do Cognito, já chave dos dados no DynamoDB) por 7 dias, para atribuir abuso a uma conta. É o único identificador de usuário no log.
- Não guarda e-mail, IP, user-agent, caminho, corpo nem cabeçalhos (nem `Authorization`).
- Retenção por `log_retention_days` (default 7).
- Sem CMK do KMS: seria custo fixo, proibido pelo ADR. O trivy aponta AVD-AWS-0017 (LOW).
- Sem `prevent_destroy`: o log group não guarda dado de negócio nem identidade e expira em 7 dias. O plan-guard já barra `delete` e `replace`.

## Autenticação

O authorizer valida assinatura, `iss` (igual a `jwt_issuer`), `exp` e a audiência: compara `jwt_audience` com `aud` e, se `aud` não existir, com `client_id` (documentação da AWS). Ele aceita access token e ID token do mesmo client: a AWS não distingue os dois. O `web/` envia o **access token**, que não carrega e-mail; a identidade do usuário é sempre o claim `sub`.

## Exemplo (`envs/<env>/main.tf`)

Os nomes de saída dos outros módulos ainda não estão em `main`; a amarração final é da #21. As rotas são ilustrativas: a lista real vem da `api/`.

```hcl
module "http_api" {
  source = "../../modules/http-api"

  name_prefix          = "acp-stg"
  function_names       = module.functions.function_names
  function_invoke_arns = module.functions.function_invoke_arns
  jwt_issuer           = module.auth.issuer
  jwt_audience         = [module.auth.client_id]
  cors_allowed_origins = ["https://staging.exemplo.com"]
  default_throttle     = { rate_limit = 10, burst_limit = 20 }

  routes = {
    "POST /estimates" = { throttle = { rate_limit = 1, burst_limit = 5 } }
    "GET /quota"      = {}
    "GET /designs"    = {}
  }
}
```

## Permissões de quem aplica

O papel de apply (bootstrap, #13, do autor) precisa destas ações para ligar o log de acesso do stage: `logs:CreateLogDelivery`, `logs:PutResourcePolicy`, `logs:UpdateLogDelivery`, `logs:DeleteLogDelivery`, `logs:CreateLogGroup`, `logs:DescribeResourcePolicies`, `logs:GetLogDelivery`, `logs:ListLogDeliveries` (em `*`) e `logs:DescribeLogGroups`. Fonte: guia do API Gateway, "Configure logging for HTTP APIs". Sem elas, o apply do stage falha.

O prefixo `/aws/vendedlogs/` é a recomendação da AWS para que a resource policy do CloudWatch Logs não cresça a cada log group.

## Custo

Nenhum custo fixo. A HTTP API cobra por requisição; o log de acesso cobra ingestão e armazenamento (7 dias). Sem CMK, WAF nem domínio pago.

## Validar e testar

```bash
terraform -chdir=infra/modules/http-api init -backend=false
terraform -chdir=infra/modules/http-api validate
terraform -chdir=infra/modules/http-api test
```

`tests/http_api.tftest.hcl` usa provider simulado e só faz `plan`, sem credenciais. O `.terraform.lock.hcl` gerado no módulo não deve ser commitado (só os dos ambientes são versionados). O CI roda `fmt`, tflint e trivy em todo `infra/`, mas `validate` só nos ambientes, e não roda `terraform test` (lacuna conhecida, Issue #117).
