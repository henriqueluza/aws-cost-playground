# Infra e deploy

Terraform e módulos: ver [`infra/README.md`](../infra/README.md). Este documento descreve o pipeline de deploy de staging (#22), o de produção (#23) e o que o autor precisa cadastrar para ligá-los. Rollback: [`runbooks/rollback.md`](runbooks/rollback.md).

## O que o pipeline faz

Workflow `deploy-staging.yml`, disparado por `push` em `main`.

- **Concorrência** no nível do workflow (`deploy-staging`, sem cancelar o que está rodando): nunca há dois deploys ao mesmo tempo, e staging nunca volta para um commit mais velho. O GitHub guarda só um run pendente: um push novo substitui o pendente, e o último commit é o que fica publicado.
- **Job `build`** (sem credencial AWS): gera o bundle do `web/` e o zip das Lambdas (`scripts/build-functions.sh`, Python de `api/.python-version`, arm64). Guarda tudo uma vez como artefato `release-<sha>`, por 90 dias:

| Item | Conteúdo |
|---|---|
| `functions.zip` | Zip das Lambdas: `app/`, dependências de runtime e `contracts/` (só `blocks.json` e `edges.json`) |
| `site/` | Conteúdo de `web/dist` |
| `SHA256SUMS` | Hashes para `sha256sum -c` |

- **Job `deploy`** (Environment `staging`): usa só o artefato e nunca reconstrói.

## Ordem do job `deploy`

| Passo (id) | O que faz |
|---|---|
| `gate` | Confere a configuração. Sem `AWS_APPLY_ROLE_ARN`, avisa e o resto é pulado (ver abaixo) |
| `download` | Baixa o artefato `release-<sha>` |
| `verify` | `sha256sum -c SHA256SUMS` |
| `aws` | OIDC no papel `acp-ci-apply-staging`, sem chave estática |
| `package` | Sobe o zip para `functions/<sha>.zip` no bucket de artefatos, sem sobrescrever (`--if-none-match`). Se a chave já existe com outro conteúdo, o deploy falha fechado: a função só roda o zip conferido pelo `SHA256SUMS`. Para repetir um deploy, use "Re-run failed jobs", que reaproveita o artefato. Depois de um "Re-run all jobs" com zip diferente, a saída é um commit novo (outra chave) ou o autor apagar `functions/<sha>.zip` à mão com credencial de administrador, porque o papel apply não tem `s3:DeleteObject` |
| `terraform` | `init`, `plan`, plan-guard e `apply` do plano salvo. O plan-guard aqui não tem liberação por label: `delete`, `replace` ou `forget` param o deploy |
| `functions` | Espera as funções atualizarem e confere o `CodeSha256` |
| `site` | Sobe `assets/` antes, sem apagar o que é antigo e sem o `config.json` do bundle |
| `config` | Publica `/config.json` a partir da saída `site_config` |
| `invalidate` | Invalida `/*` no CloudFront |
| `smoke` | Site responde 200; `/config.json` igual ao publicado; `GET /quota` sem token devolve 401 |
| `summary` | Resumo do deploy |

## Rotas do API Gateway

Todas atrás do authorizer JWT do Cognito (nenhuma anônima). `/estimates` e `/quota` vão para a função `llm-proxy`; o resto, para `api`. Os métodos do CORS (`GET`, `POST`, `PATCH`, `DELETE`) saem das chaves de `routes`; rota ausente responde 404 no gateway.

| Rota | Função |
|---|---|
| `POST /estimates` | `llm-proxy` |
| `GET /quota` | `llm-proxy` |
| `DELETE /me` | `api` |
| `GET /designs`, `POST /designs` | `api` |
| `GET /designs/{design_id}`, `PATCH /designs/{design_id}`, `DELETE /designs/{design_id}` | `api` |
| `POST /designs/{design_id}/duplicate` | `api` |

## Sem configuração

- Sem `AWS_APPLY_ROLE_ARN`, o `gate` emite um aviso e o workflow termina verde. O GitHub registra um deployment em `staging` mesmo assim e, se o Environment ainda não existir, o cria sem regras. Restrinja-o a `main` (#77) antes de cadastrar as variáveis. O trust do papel já exige `ref` igual a `refs/heads/main`, e essa restrição é a segunda camada.
- Com o papel e faltando outro valor, o `gate` falha fechado e a mensagem cita só o nome.

## Variáveis que o autor cria

| Nome | Onde | Tipo | Origem | Para quê |
|---|---|---|---|---|
| `AWS_APPLY_ROLE_ARN` | Environment `staging` | variável | Saída `github_environment_variables` do bootstrap | Papel `acp-ci-apply-staging` assumido por OIDC. Sem ele o deploy só avisa |
| `TF_VAR_PACKAGE_BUCKET` | Environment `staging` | variável | Saída `github_environment_variables` do bootstrap (#209): `acp-artifacts-stg-<id da conta>` | Destino de `functions/<sha>.zip`; vira `TF_VAR_package_bucket` |
| `TF_STATE_BUCKET_STAGING` | repositório | variável | Saída `github_variables` do bootstrap | Backend do Terraform (já usada pelo job `plan`) |
| `TF_VAR_ZONE_NAME` | repositório | variável | Domínio da zona do Route 53 | Zona pública (já usada pelo job `plan`) |
| `TF_VAR_ALARM_EMAIL` | repositório | secret | E-mail dos alarmes | Tem de ser o mesmo do primeiro apply; outro valor faz o SNS sofrer `replace` e o plan-guard barra |

```bash
gh variable set AWS_APPLY_ROLE_ARN --env staging --body "<arn>" --repo henriqueluza/aws-cost-playground
gh variable set TF_VAR_PACKAGE_BUCKET --env staging --body "<bucket>" --repo henriqueluza/aws-cost-playground
gh variable set TF_VAR_ZONE_NAME --body "<zona>" --repo henriqueluza/aws-cost-playground
gh secret set TF_VAR_ALARM_EMAIL --repo henriqueluza/aws-cost-playground   # pede o valor; não o passe na linha de comando
```

`AWS_APPLY_ROLE_ARN` e `TF_STATE_BUCKET_STAGING` saem do bootstrap (`infra/bootstrap/README.md`, "Saídas que viram variáveis do GitHub").

## Ordem para ligar o pipeline

Cadastre `AWS_APPLY_ROLE_ARN` por último: é ele que liga o deploy.

O runtime `python3.14` das Lambdas já está resolvido (#307): o módulo `functions` acompanha `api/.python-version` e um teste reprova a divergência. Sem isso o zip não carregaria, e o smoke não perceberia.

1. #166, #167, #169 e #338 (em `main`; a #338 traz o risco aceito pelo autor e o que ficou manual, em `infra/bootstrap/README.md`): permissões de escrita do apply. Além do Terraform, o deploy precisa de `s3:PutObject`/`s3:GetObject` no bucket de artefatos, de objetos do bucket do site, de `lambda:GetFunctionConfiguration` e de `cloudfront:CreateInvalidation`/`cloudfront:GetInvalidation`.
2. #209 (em `main`): bucket de artefatos, um por ambiente, criado no bootstrap com `s3:PutObject`/`s3:GetObject` do papel apply só em `functions/*` (`infra/bootstrap/README.md`, "Bucket de artefatos"). O autor reaplica o bootstrap para criá-lo.
3. #77: bootstrap aplicado, Environment `staging` restrito a `main` e primeiro apply manual.
4. As variáveis da seção anterior.

## Produção

Workflow `deploy-production.yml`. Só roda por `workflow_dispatch`, disparado por um humano, com o campo `sha`: o SHA completo de um commit de `main` que já foi publicado em staging. Nada é reconstruído.

- **Concorrência** `deploy-production`, sem cancelar o que está rodando.
- **Título do run:** `Deploy production <sha>`, com o SHA pedido. É por ele que o runbook de rollback acha o deploy anterior.
- **Job `check`** (sem Environment e sem credencial AWS). As recusas ficam em `infra/tools/release_gate.py`; `scripts/find-staging-release.sh` consulta a API do GitHub:
  1. o SHA tem 40 hexadecimais minúsculos, o workflow roda em `refs/heads/main` e o commit é ancestral de `origin/main`;
  2. existe um run de `deploy-staging.yml` desse SHA (`push` em `main`) concluído com sucesso, e nele o job `deploy (staging)` e o passo `Smoke test` terminaram com sucesso. Um run verde com o deploy pulado (staging sem configuração) não conta;
  3. o artefato `release-<sha>` desse run é baixado e confere com o `SHA256SUMS`;
  4. `site/prices/manifest.json` tem `source: price-list`. Com `source: seed` o deploy é recusado.
- **Job `deploy`** (Environment `production`): baixa o mesmo artefato do mesmo run, confere de novo e publica com os mesmos comandos de staging. Só segue se o `SHA256SUMS` baixado tiver o hash que o `check` registrou. Os dois jobs consultam o run de staging de novo depois do download e exigem o mesmo run e a mesma tentativa: um "Re-run all jobs" de staging troca o artefato, e o deploy de produção para. O teste `test_workflow_deploy_production.py` compara os passos dos dois workflows.

O mesmo artefato vale para os dois ambientes: o zip das funções vai para `functions/<sha>.zip` no bucket de artefatos de produção, sem sobrescrever, e as funções só passam se o `CodeSha256` for o desse zip.

## Ordem do job `deploy` de produção

| Passo (id) | O que faz |
|---|---|
| `gate` | Confere a configuração. Falta de qualquer valor falha fechada (produção nunca é pulada em silêncio) |
| `source` | Checkout do SHA publicado em `release-src/`, só para o Terraform |
| `download` | Baixa o artefato `release-<sha>` do run de staging |
| `verify` | Hash do `SHA256SUMS` igual ao do `check`, `sha256sum -c SHA256SUMS`, origem dos preços e o mesmo run de staging |
| `aws` | OIDC no papel `acp-ci-apply-production`, sem chave estática |
| `package` | Igual a staging, no bucket de artefatos de produção |
| `terraform` | `init`, `plan`, plan-guard e `apply` do plano salvo de `infra/envs/production` no SHA publicado. O plan-guard é o do commit do disparo |
| `functions` | Espera as funções atualizarem e confere o `CodeSha256` |
| `site` | Sobe `assets/` antes, sem apagar o que é antigo e sem o `config.json` do bundle |
| `config` | Publica `/config.json` a partir da saída `site_config` |
| `invalidate` | Invalida `/*` no CloudFront |
| `smoke` | `scripts/smoke-test.sh`: site responde; `/config.json` igual ao publicado; `/prices/manifest.json` igual ao do release; `GET /quota` sem token devolve 401 |
| `summary` | Commit publicado, run de staging de origem, pacote e `code_sha256` |

## Variáveis de produção que o autor cria

| Nome | Onde | Tipo | Origem |
|---|---|---|---|
| `AWS_APPLY_ROLE_ARN` | Environment `production` | variável | Saída `github_environment_variables` do bootstrap (papel `acp-ci-apply-production`) |
| `TF_VAR_PACKAGE_BUCKET` | Environment `production` | variável | Saída `github_environment_variables` do bootstrap (#209): `acp-artifacts-prod-<id da conta>` |
| `TF_STATE_BUCKET_PRODUCTION` | repositório | variável | Saída `github_variables` do bootstrap (já usada pelo job `plan`) |
| `TF_VAR_ZONE_NAME` | repositório | variável | A mesma de staging |
| `TF_VAR_ALARM_EMAIL` | repositório | secret | O mesmo de staging |

```bash
gh variable set AWS_APPLY_ROLE_ARN --env production --body "<arn>" --repo henriqueluza/aws-cost-playground
gh variable set TF_VAR_PACKAGE_BUCKET --env production --body "<bucket>" --repo henriqueluza/aws-cost-playground
```

O Environment `production` tem de aceitar só o branch `main` (Settings → Environments → Deployment branches). O trust do papel exige `environment:production`, `ref` igual a `refs/heads/main` e `aud` `sts.amazonaws.com`; o release-gate recusa qualquer outro `ref` antes disso. As permissões de escrita do papel estão em `main` (#167, #169 e #338; o que a #338 deixou como tarefa manual do autor está em `infra/bootstrap/README.md`); o bucket de artefatos vem do bootstrap (#209), como em staging.

## Limites de produção

- Enquanto o catálogo de preços do repositório for a semente (`source: seed`), todo deploy de produção é recusado.
- Depois de 90 dias o artefato expira e o SHA deixa de ser publicável por este workflow (ver o runbook de rollback).
- O release-gate identifica o deploy de staging pelo nome do job (`deploy (staging)`) e do passo (`Smoke test`). Renomear um deles em `deploy-staging.yml` exige ajustar `release_gate.py`; o teste trava isso.
- O Terraform de um SHA antigo pode pedir para apagar o que commits mais novos criaram. O plan-guard para o deploy nesse caso.
- O Terraform do SHA publicado roda com o papel de produção. Um `local-exec` ou uma fonte `external` nesse código executaria com essa credencial; hoje não há nenhum, e a revisão de PR de `infra/` é a barreira.
- O GitHub guarda só um run pendente por grupo de concorrência. Um terceiro disparo, com outro deploy rodando e um na fila, substitui o da fila.
- O job `check` roda as ferramentas do branch de onde o workflow foi disparado, sem credencial. Só o `deploy` recebe o papel, e só a partir de `main`.

## Workflow de preços

Workflow `prices.yml` (#222, parte da #29), por `schedule` (segunda-feira, 09:17 UTC) e `workflow_dispatch`. Só roda em `main` e não usa `environment:`, como exige o trust do papel `acp-ci-prices`. O job `generate` assume o papel por OIDC (variável de repositório `AWS_PRICES_ROLE_ARN`) e gera o catálogo; o job `publish`, sem AWS, abre ou atualiza o PR único da branch `prices/catalogo`. Sem a variável, o workflow avisa e termina verde. O PR do `GITHUB_TOKEN` não roda o CI: o autor fecha e reabre antes de juntar. Passo a passo e validação: [`docs/runbooks/setup-aws.md`](runbooks/setup-aws.md), seção 8.

## Workflow export-validate

Workflow `export-validate.yml` (#68), job `export-validate` (check `terraform validate dos cenários exportados`). Roda em `pull_request` para `main` só quando o PR muda `web/src/features/export/**`, `contracts/**`, `infra/tools/export_validate_report.py` ou o próprio workflow. Instala o Terraform 1.16.0 e roda `terraform.local.test.ts` com o provider da AWS nos 3 cenários de `contracts/scenarios/`, com cache de plugins em `$RUNNER_TEMP`. `permissions: contents: read`; não usa AWS, OIDC nem segredo, e um passo recusa qualquer variável `AWS_*`. Detalhes do teste: [`terraform-export.md`](architecture/aws-cost-playground/terraform-export.md), seção "Como conferir".

- **Proteção de branch:** não marque esse check como obrigatório. Por causa do filtro de `paths`, um PR que não toca esses caminhos ficaria esperando para sempre um check que nunca é criado. Quando roda e reprova, o status vermelho já barra o auto-merge, que exige verde. Se o autor quiser torná-lo obrigatório, tire o filtro de `paths` e faça o job rodar sempre, com um passo que compara os arquivos alterados e termina verde cedo. A proteção de branch é configurada à mão pelo autor.
- **Limite:** o filtro segue a Issue (export e contracts). Mudança só em `web/src/shared/lib/design` ou em `web/src/features/pricing`, de onde o export importa schema e tipos, não dispara o job.

## Limites conhecidos

- O smoke 401 vem do authorizer JWT do API Gateway e não invoca a Lambda (não há rota pública). Um zip que não importa passa verde.
- O artefato do GitHub dura 90 dias (máximo em repositório público). O zip continua no bucket, por SHA.
- Arquivos antigos do site não são apagados (regra do módulo `site`).
- A invalidação `/*` conta como 1 caminho na cota grátis de 1000/mês.
- O workflow está em `.github/workflows/deploy-staging.yml` e roda a cada merge em `main`. Sem a variável `AWS_APPLY_ROLE_ARN` no Environment `staging`, o job de deploy só avisa e termina verde.
- Os ajustes de `validate.yml` e `terraform.yml` ficam na #211.
