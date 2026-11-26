# infra

Terraform da AWS (us-east-1, 100% serverless). Decisões em `docs/architecture/aws-cost-playground/ADR-0001-stack.md`.

## Estrutura

| Pasta | Conteúdo |
|---|---|
| `modules/` | Módulos reutilizáveis, cada um com README próprio (hoje: `alarms`, `auth`, `database`, `dns`, `functions`, `http-api` e `site`, o bucket privado + CloudFront da SPA) |
| `envs/staging` | Raiz do ambiente `staging`: compõe os sete módulos (`main.tf`, `variables.tf` e `outputs.tf` genéricos; valores em `terraform.tfvars`) |
| `envs/production` | Raiz do ambiente `production`: por ora só backend e versões; recebe os mesmos arquivos na #168 |
| `tools/` | `plan_guard.py` e seus testes |
| `bootstrap/` | Buckets de estado, provedor OIDC e papéis de CI, com README próprio; só o autor aplica. Agentes não tocam sem Issue que autorize |

## Regras para agentes

- Nunca rodar `apply`, `destroy`, `import` nem comandos de estado (`state`, `force-unlock`...).
- Validar só assim:

```bash
terraform -chdir=infra/envs/<env> init -backend=false && terraform -chdir=infra/envs/<env> validate
```

Módulo com testes (`tests/*.tftest.hcl`, provider simulado, sem credenciais): `terraform -chdir=infra/modules/<m> init -backend=false && terraform -chdir=infra/modules/<m> validate && terraform -chdir=infra/modules/<m> test`. O lockfile do módulo não é versionado, e o CI só roda `validate` nos ambientes.

O ambiente também tem teste de composição com provider simulado (o CI ainda não roda `terraform test`, #117):

```bash
terraform -chdir=infra/envs/staging init -backend=false && terraform -chdir=infra/envs/staging test
python3 -m unittest discover -s infra/tools/tests   # tfvars sem segredo e arquivos iguais entre ambientes
```

## Variáveis dos ambientes

Nenhuma variável tem default: sem o valor, o `plan` falha fechado.

| Variável | Origem |
|---|---|
| `environment`, `self_signup_enabled`, `point_in_time_recovery_enabled`, `llm_enabled`, `default_throttle`, `estimates_throttle` | `terraform.tfvars` do ambiente (versionado, sem segredo). `llm_enabled` fica `false` nos dois ambientes; os limites de taxa são os sugeridos no passo 2 de [`docs/runbooks/guardrails-de-custo.md`](../docs/runbooks/guardrails-de-custo.md). Todos mudam por PR |
| `zone_name` | `TF_VAR_zone_name`, variável do GitHub Environment: domínio da zona do Route 53 |
| `alarm_email` | `TF_VAR_alarm_email`, secret do GitHub Environment (variável sensível no Terraform) |
| `package_bucket` | `TF_VAR_package_bucket`, variável do GitHub Environment: bucket de artefatos com o zip das funções. Ainda não existe em nenhum módulo; quem cria é decisão pendente (#22) |
| `package_key` | `TF_VAR_package_key`, variável do GitHub Environment: montada pelo pipeline com o SHA |

Atenção: o job `plan` do `terraform.yml` hoje não passa `TF_VAR_*`. Quando `AWS_PLAN_ROLE_ARN` for cadastrada, o plano falhará até o workflow passar essas variáveis (mudança de workflow, só com autorização do autor: #171).

## Saídas para o deploy

| Saída | Uso |
|---|---|
| `site_bucket_name` | Destino do bundle do site e do `/config.json` |
| `site_distribution_id` | Distribuição CloudFront a invalidar |
| `function_names` | Funções Lambda a atualizar |
| `site_config` | Conteúdo do `/config.json` |

```bash
terraform output -json site_config > config.json
```

Chaves: `apiBaseUrl`, `cognitoAuthority`, `cognitoClientId`, iguais ao schema de `web/src/shared/config/runtimeConfig.ts`.

## Saídas para os runbooks

| Saída | Uso |
|---|---|
| `api_id` | O `<API_ID>` dos runbooks de guardrails e de alarmes |
| `function_role_names` | Papel de cada função; o do `llm-proxy` é o alvo da ação de corte do Budgets, criada à mão |
| `llm_api_key_parameter_name` | Nome do parâmetro do SSM com a chave da Claude API (ver "Primeiro apply") |
| `alarm_topic_arn` | Tópico SNS dos alarmes, para conferir a confirmação da assinatura |

## Primeiro apply (feito pelo autor)

- O zip das funções precisa existir no bucket de artefatos antes.
- A validação do ACM e o domínio do Cognito podem levar até ~1 h; se falhar por tempo, rode o plan de novo.
- O parâmetro do SSM com a chave da Claude API **não é criado pelo Terraform**. O autor o cria à mão, com o nome da saída `llm_api_key_parameter_name` (ver `modules/functions/README.md`), e só então muda `llm_enabled` para `true` por PR. Até lá fica `false`, nos dois ambientes.
- O e-mail de `alarm_email` recebe uma confirmação de assinatura do SNS, que precisa ser aceita; sem ela nenhum alarme chega (ver `modules/alarms/README.md` e `docs/runbooks/alarmes.md`).
- Cada ambiente cria 5 alarmes do CloudWatch; os dois somam a franquia gratuita de 10. Alarme novo é custo: decisão do autor.
- Nunca `import` nem `state`.

## Backend

Estado no S3 com lock nativo (`use_lockfile`), sem DynamoDB. O nome do bucket **não está no código**: entra no `init` por `-backend-config="bucket=..."`.

| Ambiente | Chave do estado | Variável de repositório (CI) |
|---|---|---|
| staging | `acp-stg/terraform.tfstate` | `TF_STATE_BUCKET_STAGING` |
| production | `acp-prod/terraform.tfstate` | `TF_STATE_BUCKET_PRODUCTION` |

No CI, o papel de leitura vem de `AWS_PLAN_ROLE_ARN` (workflow `terraform.yml`). Os buckets e o papel são criados por `bootstrap/`, que também gera essas variáveis: ver `bootstrap/README.md`.

`.terraform.lock.hcl` é versionado em cada ambiente. Atualizar provider é um PR `chore` próprio.

## plan-guard

Reprova planos que apagam, substituem ou esquecem recursos.

```bash
terraform show -json plano > plan.json && python3 infra/tools/plan_guard.py plan.json
```

| Saída | Significado |
|---|---|
| 0 | Nenhuma ação destrutiva |
| 1 | Há `delete`, `replace` ou `forget`; uma linha por recurso na stdout |
| 2 | Entrada inválida, inclusive ação que o guard não conhece (falha fechada); mensagem na stderr |

Formato da linha: `<kind>\t<address>\t<ação1,ação2>`, só endereço e ações, nunca valores do plano. `forget` (bloco `removed` com `destroy = false`) também bloqueia, pois equivale a um `state rm`.

Liberação só pela label `infra:destroy-approved`, aplicada pelo autor.

Testes:

```bash
python3 -m unittest discover -s infra/tools/tests
```

## Qualidade

```bash
terraform fmt -check -recursive infra
tflint --chdir=infra --recursive --config="$PWD/infra/.tflint.hcl"
trivy config infra
```
