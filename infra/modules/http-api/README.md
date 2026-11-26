# Módulo `http-api`

API Gateway HTTP API na frente das duas Lambdas (`api` e `llm-proxy`), com authorizer JWT do Cognito em todas as rotas. Completo com as partes 1 (#131) e 2 (#132) da #19. A única porta da API é o domínio próprio; o endpoint `execute-api` padrão está desligado.

## O que cria

- API HTTP com CORS (lista explícita de origens).
- Authorizer JWT do Cognito, com identity source `$request.header.Authorization`.
- Duas integrações `AWS_PROXY` (payload 2.0, timeout de 30 s). O limite real é o da função, 10 s na `api` e 29 s no `llm-proxy`, definido no módulo `functions`.
- A permissão de invocação de cada função, restrita a esta API.
- Uma rota por entrada de `routes`, todas com o authorizer.
- Log group do log de acesso `/aws/vendedlogs/apigateway/<name_prefix>-http-api`, com retenção por variável.
- Stage `$default` com auto deploy, limite de taxa padrão e por rota.
- Domínio próprio regional (TLS 1.2), com o certificado ACM vindo por variável.
- Mapeamento do domínio inteiro para o stage `$default`.
- A API com o endpoint `execute-api` desligado.

## O que não cria

- Certificado ACM e registro de alias no Route 53: módulo `dns` (#121). Este módulo só expõe o alvo em `domain_alias`.
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
| `domain_name` | `string` | Domínio próprio da API, como `api.staging.exemplo.com` (saída `domain_names.api` do módulo `dns`). Minúsculas, sem esquema, porta nem curinga. Obrigatório, sem default. |
| `acm_certificate_arn` | `string` | Certificado ACM que cobre `domain_name` (saída `certificate_arns["api"]` do módulo `dns`). Tem de estar em `us-east-1`, a região da API: domínio regional exige certificado na mesma região. Obrigatório, sem default. |
| `routes` | `map(object)` | Rotas da API; ver "Rotas". `throttle` (`rate_limit`, `burst_limit`) é opcional. |
| `default_throttle` | `object` | Limite das rotas sem `throttle` próprio. Obrigatório, sem default. `rate_limit > 0` e `burst_limit` inteiro, no mínimo 1. |
| `log_retention_days` | `number` | Retenção do log de acesso. Default 7 (valor do ADR); aceita 1, 3, 5, 7, 14 ou 30. |

## Outputs

| Nome | Descrição |
|---|---|
| `api_id` | Id da API: dimensão `ApiId` dos alarmes e `<API_ID>` do runbook de guardrails. |
| `access_log_group_name` | Nome do log group do log de acesso, para conferir a retenção (runbook de guardrails, passo 6). |
| `domain_alias` | `{ name, zone_id }` do domínio próprio (`target_domain_name` e `hosted_zone_id`). Alvo do registro de alias, no formato da variável `api_alias` do módulo `dns`. |

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

## Domínio próprio

- `REGIONAL` e `TLS_1_2` são literais no módulo, não variáveis: são os únicos valores que a HTTP API aceita, e uma variável só permitiria afrouxar.
- O mapeamento leva o domínio inteiro ao stage `$default`, sem `api_mapping_key`.
- Com `disable_execute_api_endpoint = true`, o endpoint `execute-api` padrão deixa de atender chamadas. Quem chama a API usa só o domínio próprio; o `/config.json` do site aponta para `https://api.<domínio>` (#21).
- `domain_alias` sai só do recurso de domínio. O registro no Route 53 é do módulo `dns`: ligue `api_alias = module.http_api.domain_alias` lá. Não há ciclo, porque `domain_names` e `certificate_arns` do `dns` não dependem de `api_alias`.
- Sem `prevent_destroy`: o domínio não guarda dado nem identidade e se recria do código. O plan-guard barra `delete` e `replace`. Trocar `domain_name` gera `replace` (`needs-human`); trocar o certificado é alteração in-place.

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
  domain_name          = module.dns.domain_names.api
  acm_certificate_arn  = module.dns.certificate_arns["api"]

  routes = {
    "POST /estimates" = { throttle = { rate_limit = 1, burst_limit = 5 } }
    "GET /quota"      = {}
    "GET /designs"    = {}
  }
}

module "dns" {
  # ...
  api_alias = module.http_api.domain_alias
}
```

## Permissões de quem aplica

O papel de apply (bootstrap, #13, do autor) precisa destas ações para ligar o log de acesso do stage: `logs:CreateLogDelivery`, `logs:PutResourcePolicy`, `logs:UpdateLogDelivery`, `logs:DeleteLogDelivery`, `logs:CreateLogGroup`, `logs:DescribeResourcePolicies`, `logs:GetLogDelivery`, `logs:ListLogDeliveries` (em `*`) e `logs:DescribeLogGroups`. Fonte: guia do API Gateway, "Configure logging for HTTP APIs". Sem elas, o apply do stage falha.

Pendência: as ações de IAM para criar o domínio e o mapeamento ainda não foram verificadas; só o primeiro apply (#21, #13) confirma.

O prefixo `/aws/vendedlogs/` é a recomendação da AWS para que a resource policy do CloudWatch Logs não cresça a cada log group.

## Custo

Nenhum custo fixo. A HTTP API cobra por requisição; o log de acesso cobra ingestão e armazenamento (7 dias). O domínio próprio da HTTP API e o certificado público do ACM não têm custo fixo (preços na página de preços da AWS). Sem CMK nem WAF. O único custo fixo é a zona do Route 53, do autor.

## Validar e testar

```bash
terraform -chdir=infra/modules/http-api init -backend=false
terraform -chdir=infra/modules/http-api validate
terraform -chdir=infra/modules/http-api test
```

`tests/http_api.tftest.hcl` usa provider simulado e só faz `plan`, sem credenciais. Inclui o domínio e a rejeição das duas variáveis novas. A fixture `tests/consumer` só existe para teste: liga `dns` e `http-api` nos dois sentidos e prova por `plan` que não há ciclo. Por causa dela, o `init` instala também o módulo `dns` local. O `.terraform.lock.hcl` gerado no módulo não deve ser commitado (só os dos ambientes são versionados). O CI roda `fmt`, `validate`, `terraform test`, tflint e trivy neste módulo (`infra/tools/tf_checks.sh`).
