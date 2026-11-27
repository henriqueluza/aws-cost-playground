# infra

Terraform da AWS (us-east-1, 100% serverless). Decisões em `docs/architecture/aws-cost-playground/ADR-0001-stack.md`.

## Estrutura

| Pasta | Conteúdo |
|---|---|
| `modules/` | Módulos reutilizáveis, cada um com README próprio (hoje: `alarms`, `auth`, `database`, `dns`, `functions`, `http-api` e `site`, o bucket privado + CloudFront da SPA) |
| `envs/staging` | Raiz do ambiente `staging`: compõe os sete módulos (`main.tf`, `variables.tf` e `outputs.tf` genéricos; valores em `terraform.tfvars`) |
| `envs/production` | Raiz do ambiente `production`: os mesmos `main.tf`, `variables.tf` e `outputs.tf` de staging, byte a byte; `backend.tf`, `versions.tf` e `terraform.tfvars` mudam (ver "Diferença entre os ambientes") |
| `tools/` | `plan_guard.py` e seus testes |
| `bootstrap/` | Buckets de estado, provedor OIDC e papéis de CI, com README próprio; só o autor aplica. Agentes não tocam sem Issue que autorize |

## Regras para agentes

- Nunca rodar `apply`, `destroy`, `import` nem comandos de estado (`state`, `force-unlock`...).
- Validar só assim:

```bash
terraform -chdir=infra/envs/<env> init -backend=false && terraform -chdir=infra/envs/<env> validate
```

Módulo com testes (`tests/*.tftest.hcl`, provider simulado, sem credenciais): `terraform -chdir=infra/modules/<m> init -backend=false && terraform -chdir=infra/modules/<m> validate && terraform -chdir=infra/modules/<m> test`. O lockfile do módulo não é versionado.

Cada ambiente também tem teste de composição com provider simulado:

```bash
terraform -chdir=infra/envs/<env> init -backend=false && terraform -chdir=infra/envs/<env> test
python3 -m unittest discover -s infra/tools/tests   # tfvars sem segredo e arquivos iguais entre ambientes
```

## Diferença entre os ambientes

`main.tf`, `variables.tf`, `outputs.tf` e `.terraform.lock.hcl` são iguais byte a byte nos dois ambientes (`test_envs.py` trava isso). Mudar a composição é editar os dois diretórios no mesmo PR. `backend.tf` e `versions.tf` diferem só na chave do estado e na tag `environment`. O resto é valor de `terraform.tfvars`:

| Variável | staging | production |
|---|---|---|
| `environment` | `staging` (prefixo `acp-stg`, site em `staging.<zona>`) | `production` (prefixo `acp-prod`, site na própria zona) |
| `point_in_time_recovery_enabled` | `false` | `true` |
| `self_signup_enabled` | `false` | `true`. Risco aceito pelo autor na #139 e registrado no ADR; para fechar o cadastro, troque essa linha para `false` por PR |
| `llm_enabled`, `default_throttle`, `estimates_throttle` | iguais | iguais |

## Variáveis dos ambientes

Nenhuma variável tem default: sem o valor, o `plan` falha fechado.

| Variável | Origem |
|---|---|
| `environment`, `self_signup_enabled`, `point_in_time_recovery_enabled`, `llm_enabled`, `default_throttle`, `estimates_throttle` | `terraform.tfvars` do ambiente (versionado, sem segredo). `llm_enabled` fica `false` nos dois ambientes; os limites de taxa são os sugeridos no passo 2 de [`docs/runbooks/guardrails-de-custo.md`](../docs/runbooks/guardrails-de-custo.md). Todos mudam por PR |
| `zone_name` | `TF_VAR_zone_name`, que o pipeline lê da variável de repositório `TF_VAR_ZONE_NAME` (a mesma do job `plan`): domínio da zona do Route 53 |
| `alarm_email` | `TF_VAR_alarm_email`, que o pipeline lê do secret de repositório `TF_VAR_ALARM_EMAIL` (o mesmo do job `plan`; variável sensível no Terraform) |
| `package_bucket` | `TF_VAR_package_bucket`, variável do GitHub Environment: bucket de artefatos com o zip das funções. Um por ambiente, criado no bootstrap pela #209 e lido pelo pipeline em `TF_VAR_PACKAGE_BUCKET` |
| `package_key` | `TF_VAR_package_key`, montada pelo pipeline com o SHA no formato `functions/<sha>.zip` (nada a cadastrar) |

Esses são os valores do deploy (#22; ver [`docs/infra.md`](../docs/infra.md)). O job `plan` do `terraform.yml` não lê GitHub Environment: ver a seção seguinte.

## Variáveis do job plan

O job `plan` roda em `pull_request` e sem `environment:` (o trust do papel `plan` exige `sub = repo:<dono>/<repo>:pull_request`, ver `bootstrap/README.md`). Por isso ele lê os valores no nível do **repositório**, e o autor os cadastra uma vez para os dois ambientes:

| Nome no GitHub | Tipo | Vira | Para quê |
|---|---|---|---|
| `TF_VAR_ZONE_NAME` | variável de repositório | `TF_VAR_zone_name` | Domínio da zona pública do Route 53. Tem de ser o real: o plano lê a zona (`data "aws_route53_zone"`) |
| `TF_VAR_ALARM_EMAIL` | secret de repositório | `TF_VAR_alarm_email` | E-mail dos alarmes. Tem de ser o mesmo do apply: outro valor apareceria como `replace` da assinatura do SNS e o plan-guard reprovaria todo PR |
| (nenhum) | valor fixo no workflow | `TF_VAR_package_bucket=acp-plan-placeholder`, `TF_VAR_package_key=plan/placeholder.zip` | Fictícios: o plano não lê o S3. Depois do primeiro apply o plano mostra `update` nas funções por causa deles; `update` não reprova |

```bash
gh variable set TF_VAR_ZONE_NAME --body "<zona>" --repo henriqueluza/aws-cost-playground
gh secret set TF_VAR_ALARM_EMAIL --repo henriqueluza/aws-cost-playground   # pede o valor; não o passe na linha de comando
```

- Cadastre os dois **antes** de `AWS_PLAN_ROLE_ARN`. Com o papel cadastrado e um deles faltando, o passo `terraform plan` falha fechado e a mensagem cita só o nome do que falta.
- Sem `AWS_PLAN_ROLE_ARN` o job continua pulado e o PR fica verde.
- O e-mail é o único secret do workflow e só entra no passo `terraform plan`. O GitHub o mascara no log, o Terraform o trata como `sensitive`, e o plan-guard imprime só endereço e ações. O `plan.json` (que tem o valor) fica em `$RUNNER_TEMP` e não vira artefato.
- Limite conhecido: o job roda o Terraform do próprio PR, então um PR do repositório consegue ler esse secret. PR de fork não roda o job nem recebe secrets. A defesa é a revisão; por isso o job não recebe nenhum outro secret.

## Saídas para o deploy

| Saída | Uso |
|---|---|
| `site_bucket_name` | Destino do bundle do site e do `/config.json` |
| `site_distribution_id` | Distribuição CloudFront a invalidar |
| `function_names` | Funções Lambda a atualizar |
| `site_config` | Conteúdo do `/config.json` |
| `site_url` | `https://<host>` do site, sem barra final; usada no smoke |

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

Reprova planos que apagam, substituem, esquecem ou importam recursos.

```bash
terraform show -json plano > plan.json && python3 infra/tools/plan_guard.py plan.json
```

| Saída | Significado |
|---|---|
| 0 | Nenhuma ação destrutiva |
| 1 | Há `delete`, `replace`, `forget` ou `import`; uma linha por recurso na stdout |
| 2 | Entrada inválida, inclusive ação que o guard não conhece e plano com `errored: true` (falha fechada); mensagem na stderr |

Formato da linha: `<kind>\t<address>\t<ação1,ação2>`, só endereço e ações, nunca valores do plano. `forget` (bloco `removed` com `destroy = false`) também bloqueia, pois equivale a um `state rm`. `import` é o recurso com `change.importing` (bloco `import`), qualquer que seja a ação: importar sem mudar nada sai como `no-op`. Agentes não importam recursos; em PR, só o autor libera, com a mesma label `infra:destroy-approved`. Um plano com `errored: true` é parcial (as mudanças listadas não são o plano inteiro) e por isso não é avaliado.

Liberação só pela label `infra:destroy-approved`, aplicada pelo autor.

Testes:

```bash
python3 -m unittest discover -s infra/tools/tests
```

## Qualidade

```bash
terraform fmt -check -recursive infra
infra/tools/tf_checks.sh   # init -backend=false, validate e terraform test em tudo
tflint --chdir=infra --recursive --config="$PWD/infra/.tflint.hcl"
trivy config infra
```

`tf_checks.sh` é o que o job `fmt, validate, tflint, trivy` do `terraform.yml` roda, sem credenciais da AWS:

- Percorre `envs/*`, `bootstrap` e cada pasta de `modules/*` que tenha `.tf`, descobertas por laço. Módulo novo entra sozinho.
- Roda todos os diretórios, lista os que falharam e sai com 1 se houver algum: um teste quebrado reprova o PR.
- Nas raízes o `init` usa `-lockfile=readonly`. Cada módulo recebe uma cópia do lockfile de um ambiente (fora do git), para ser testado com o provider que os ambientes travam e não com o mais novo que a restrição aceitar.
- No CI, `TF_PLUGIN_CACHE_DIR` faz o provider ser baixado uma vez para todos os diretórios. Na sua máquina, use `plugin_cache_dir` no `~/.terraformrc`.
- Os testes do script ficam em `tools/tests/test_tf_checks.py` e precisam de `terraform` no PATH.
