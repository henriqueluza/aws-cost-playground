# Infra e deploy

Terraform e módulos: ver [`infra/README.md`](../infra/README.md). Este documento descreve o pipeline de deploy de staging (#22) e o que o autor precisa cadastrar para ligá-lo. Produção e rollback ficam na #23.

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

## Sem configuração

- Sem `AWS_APPLY_ROLE_ARN`, o `gate` emite um aviso e o workflow termina verde. O GitHub registra um deployment em `staging` mesmo assim e, se o Environment ainda não existir, o cria sem regras. Restrinja-o a `main` (#77) antes de cadastrar as variáveis. O trust do papel já exige `ref` igual a `refs/heads/main`, e essa restrição é a segunda camada.
- Com o papel e faltando outro valor, o `gate` falha fechado e a mensagem cita só o nome.

## Variáveis que o autor cria

| Nome | Onde | Tipo | Origem | Para quê |
|---|---|---|---|---|
| `AWS_APPLY_ROLE_ARN` | Environment `staging` | variável | Saída `github_environment_variables` do bootstrap | Papel `acp-ci-apply-staging` assumido por OIDC. Sem ele o deploy só avisa |
| `TF_VAR_PACKAGE_BUCKET` | Environment `staging` | variável | Bucket de artefatos criado pela #209 | Destino de `functions/<sha>.zip`; vira `TF_VAR_package_bucket` |
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

1. #210: runtime `python3.14` nas Lambdas. Sem ela o zip não carrega, e o smoke não percebe.
2. #166, #167 e #169: permissões de escrita do apply. Além do Terraform, o deploy precisa de `s3:PutObject`/`s3:GetObject` no bucket de artefatos, de objetos do bucket do site, de `lambda:GetFunctionConfiguration` e de `cloudfront:CreateInvalidation`/`cloudfront:GetInvalidation`.
3. #209: bucket de artefatos.
4. #77: bootstrap aplicado, Environment `staging` restrito a `main` e primeiro apply manual.
5. As variáveis da seção anterior.

## Limites conhecidos

- O smoke 401 vem do authorizer JWT do API Gateway e não invoca a Lambda (não há rota pública). Um zip que não importa passa verde.
- O artefato do GitHub dura 90 dias (máximo em repositório público). O zip continua no bucket, por SHA.
- Arquivos antigos do site não são apagados (regra do módulo `site`).
- A invalidação `/*` conta como 1 caminho na cota grátis de 1000/mês.
- O workflow está em `.github/workflows/deploy-staging.yml` e roda a cada merge em `main`. Sem a variável `AWS_APPLY_ROLE_ARN` no Environment `staging`, o job de deploy só avisa e termina verde.
- Os ajustes de `validate.yml` e `terraform.yml` ficam na #211.
- Produção e rollback ficam na #23.
