# infra/bootstrap

O que precisa existir antes de qualquer ambiente: os buckets de estado, o provedor OIDC do GitHub e os papéis que o CI assume. Decisões em `docs/architecture/aws-cost-playground/ADR-0001-stack.md` ("Ambientes e deploy" e "Travas contra destruição da infra").

**Quem aplica é o autor, à mão, uma única vez** (Issue #77). Agentes só alteram este diretório por Issue que o autorize de forma explícita, e nunca rodam `plan`, `apply`, `import` nem comandos de estado aqui.

## O que cria

| Recurso | Nome | Observação |
|---|---|---|
| Bucket de estado de staging | `acp-stg-tfstate-<id da conta>` | Versionamento, SSE-S3, bloqueio de acesso público, TLS obrigatório, `prevent_destroy` |
| Bucket de estado de produção | `acp-prod-tfstate-<id da conta>` | Idem |
| Provedor OIDC | `token.actions.githubusercontent.com` | Audiência `sts.amazonaws.com`; `prevent_destroy` |
| Papel `plan` | `acp-ci-plan` | Somente leitura; usado pelo job `plan` do `terraform.yml` |
| Papéis `apply` | `acp-ci-apply-staging` e `acp-ci-apply-production` | Um por ambiente, sessão de 1 hora, `prevent_destroy`. Por enquanto só leem e gravam o próprio estado e carregam as negações |

Os papéis `apply` ainda não aplicam nada: a #166 cria o limite de permissões `acp-ci-boundary-<env>`, a #167 e a #169 dão as permissões de escrita (a #169 fecha a #124) e a #125 cria o papel `prices`. Até a #166, a negação `DenyRoleWithoutBoundary` impede criar qualquer papel IAM pelo apply (falha fechada).

Nada aqui tem custo fixo: sem chave própria do KMS e sem tabela de lock (o lock é o nativo do S3). O ID da conta vem da credencial de quem aplica, nunca do código.

## Papel `plan`

| Pergunta | Resposta |
|---|---|
| Quem assume | Só um job do GitHub Actions deste repositório no evento `pull_request`: `sub` igual a `repo:henriqueluza/aws-cost-playground:pull_request` e `aud` igual a `sts.amazonaws.com`, por igualdade exata. PR de fork não recebe token OIDC |
| O que pode | `ReadOnlyAccess` (política gerenciada da AWS), o que o `terraform plan` precisa para ler a configuração dos recursos e o estado |
| O que não pode | Escrever qualquer coisa. Ler dado: itens do DynamoDB, usuários do Cognito, eventos de log, segredos (Secrets Manager e parâmetros do SSM) e objetos do S3 fora dos buckets de estado |

O job `plan` roda código do próprio PR, então o papel parte do princípio de que esse código é hostil. Limites conhecidos:

- A negação cobre os serviços que o projeto usa (lista exata em `plan.tf`, travada por teste). `ReadOnlyAccess` vale para a conta inteira: se a conta ganhar outro serviço com dado (fila, stream), acrescente a negação aqui.
- O papel lê os dois estados. Tudo que o Terraform gravar no estado fica visível para qualquer PR de branch deste repositório: **não ponha segredo no estado**.
- `ReadOnlyAccess` deixa ler a configuração dos recursos, inclusive as variáveis de ambiente das funções Lambda. A regra do projeto já proíbe segredo em variável de ambiente; aqui ela é o que protege o segredo.
- A negação de `ssm:GetParameter*` impede o `plan` de ler qualquer parâmetro. Por isso o parâmetro da chave da Claude API (`/acp/<env>/anthropic-api-key`) fica fora do Terraform e é criado à mão pelo autor (decisão da #126; ver `docs/runbooks/rotacao-de-segredos.md`). Não declare `aws_ssm_parameter` em nenhum módulo: o job `plan` falharia no refresh.

## Papéis `apply`

| Pergunta | Resposta |
|---|---|
| Quem assume | Só um job do GitHub Actions deste repositório que declare o GitHub Environment do papel e rode em `main`: `aud` igual a `sts.amazonaws.com`, `sub` igual a `repo:henriqueluza/aws-cost-playground:environment:<env>` e `ref` igual a `refs/heads/main`, tudo por `StringEquals` |
| O que pode | Só o estado do próprio ambiente (política inline `state`): `s3:ListBucket` no bucket, `GetObject` e `PutObject` em `acp-<stg\|prod>/terraform.tfstate`, e `GetObject`, `PutObject` e `DeleteObject` no `.tflock`. Nenhuma outra permissão ainda (#167 e #169) |
| O que não pode | O que a política inline `deny-guardrails` nega, na tabela abaixo. Negação explícita vence qualquer `Allow` futuro |

O `sub` de environment não carrega o branch, então o `ref` é fixado no IAM. Um job de `pull_request` não passa, porque o `ref` dele não é `refs/heads/main`.

| Sid | Nega | Por quê |
|---|---|---|
| `DenyDataDeletion` | `cognito-idp:DeleteUserPool`, `dynamodb:DeleteTable`, `dynamodb:PutResourcePolicy`, `route53:DeleteHostedZone`, `s3:DeleteBucket` | Camada IAM do ADR: um plano destrutivo aprovado por engano falha no apply. Uma política de recurso na tabela daria `DeleteTable` a outra conta |
| `DenyParameterStore` | `ssm:*` | A chave da Claude API fica num parâmetro criado à mão, fora do Terraform (#126): o CI não lê, não sobrescreve nem apaga parâmetro |
| `DenyCiIdentity` | `iam:*` nos papéis `acp-ci-*`, nas políticas `acp-ci-*` e no provedor OIDC | O papel não altera a si mesmo, os outros papéis de CI, a política de limite nem o provedor |
| `DenyIamOutsideEnvironment` | `iam:*` em tudo que não for `role/acp-<stg\|prod>-*` | Sem usuários, grupos, políticas gerenciadas, papéis do outro ambiente, papéis vinculados a serviço nem `PassRole` fora do ambiente |
| `DenyRoleWithoutBoundary` | `iam:CreateRole`, `PutRolePolicy`, `DeleteRolePolicy` e `PutRolePermissionsBoundary` em papel sem o limite `acp-ci-boundary-<env>` | O apply cria os papéis das Lambdas; sem o limite, criaria um papel sem as negações e apagaria a tabela por uma função |
| `DenyRoleBypass` | `iam:DeleteRolePermissionsBoundary`, `UpdateAssumeRolePolicy`, `AttachRolePolicy`, `DetachRolePolicy` | Tirar o limite, trocar o trust de um papel existente, anexar ou desanexar política gerenciada (desanexar desligaria o corte do Budgets no papel do proxy) |
| `DenyStateBucketConfig` | No bucket de estado do ambiente, tudo que não for ler, gravar, apagar e listar objetos | Política, versionamento, criptografia, bloqueio público, ciclo de vida e exclusão de versões. Apagar um objeto só cria um marcador: as versões antigas continuam lá |
| `DenyOtherEnvironmentState` | `s3:*` no bucket de estado do outro ambiente | Um ambiente não lê nem grava o estado do outro |

Limites conhecidos:

- O branch é garantido no IAM pelo `ref`. Restringir os GitHub Environments `staging` e `production` ao branch `main` é a segunda camada e é feita pelo autor (#77). Não existe chave de condição para o evento: push e `workflow_dispatch` em `main` não se distinguem no IAM.
- O trust só é provado no primeiro deploy depois da #77: os testes usam provider simulado.
- `iam:CreateRole` aceita qualquer trust. O apply pode criar um papel `acp-<prefixo>-*` que confie em outra conta, sempre dentro do limite; a #166 trata disso no limite.
- Quem faz deploy controla o código das Lambdas. Dentro do limite, esse código lê e apaga itens e lê a chave. O IAM não fecha isso; a revisão do PR e o `plan-guard` são as outras camadas.
- Para quem escreve módulos:
  - papéis só com política inline: sem `aws_iam_policy`, sem `aws_iam_role_policy_attachment` e sem `data "aws_iam_policy"`;
  - nomes `acp-<stg|prod>-*`;
  - sem `aws_ssm_parameter`;
  - sem papel vinculado a serviço criado pelo apply (o do API Gateway nasce no bootstrap, #169);
  - trocar o trust de um papel existente é tarefa manual do autor.

## Como aplicar (autor)

Pré-requisitos: Terraform 1.16, credencial temporária de administrador da conta (SSO ou sessão de curta duração, nunca chave de acesso gravada em arquivo) e a conta já preparada conforme `docs/runbooks/guardrails-de-custo.md`.

```bash
cd infra/bootstrap
terraform init -lockfile=readonly
terraform plan -out=bootstrap.tfplan   # confira: só criação, nenhum delete ou replace
terraform apply bootstrap.tfplan
```

Se a conta já tiver um provedor OIDC do GitHub (só pode haver um por conta), importe-o antes do `apply`:

```bash
terraform import aws_iam_openid_connect_provider.github \
  "arn:aws:iam::$(aws sts get-caller-identity --query Account --output text):oidc-provider/token.actions.githubusercontent.com"
```

## Saídas que viram variáveis do GitHub

A saída `github_variables` é um mapa cujas chaves são os nomes das variáveis de **repositório** (não são segredos) lidas pelo `.github/workflows/terraform.yml`:

| Variável | Valor |
|---|---|
| `AWS_PLAN_ROLE_ARN` | ARN do papel `plan` |
| `TF_STATE_BUCKET_STAGING` | Bucket de estado de `infra/envs/staging` |
| `TF_STATE_BUCKET_PRODUCTION` | Bucket de estado de `infra/envs/production` |

```bash
terraform output -json github_variables | jq -r 'to_entries[] | "\(.key) \(.value)"' |
  while read -r name value; do
    gh variable set "$name" --body "$value" --repo henriqueluza/aws-cost-playground
  done
```

Enquanto `AWS_PLAN_ROLE_ARN` não existir, o job `plan` é pulado.

A saída `github_environment_variables` é um mapa de dois níveis: a chave externa é o nome do GitHub Environment e a interna é o nome da variável desse Environment.

| Environment | Variável | Valor |
|---|---|---|
| `staging` | `AWS_APPLY_ROLE_ARN` | ARN do papel `acp-ci-apply-staging` |
| `production` | `AWS_APPLY_ROLE_ARN` | ARN do papel `acp-ci-apply-production` |

Pré-requisito: os Environments `staging` e `production` existem e estão restritos ao branch `main` antes de cadastrar a variável.

```bash
terraform output -json github_environment_variables |
  jq -r 'to_entries[] | .key as $env | .value | to_entries[] | "\($env) \(.key) \(.value)"' |
  while read -r env name value; do
    gh variable set "$name" --env "$env" --body "$value" --repo henriqueluza/aws-cost-playground
  done
```

## Estado deste diretório

O bootstrap cria o bucket onde o estado dos ambientes mora, então o estado dele é **local**: `infra/bootstrap/terraform.tfstate`, que o `.gitignore` já exclui. Nunca o versione.

- Depois de cada `apply`, guarde uma cópia de `terraform.tfstate` fora do repositório, num local cifrado e com backup (cofre de senhas ou disco cifrado). Ele não tem segredo, mas tem o ID da conta e os ARNs.
- Apague o `bootstrap.tfplan` depois de aplicar.
- Se o arquivo se perder, nada na AWS é afetado. Reconstrua o estado com `terraform import`, um comando por recurso, antes de qualquer `apply`:

| Endereço | ID de importação |
|---|---|
| `aws_s3_bucket.state["staging"]` e os quatro recursos `aws_s3_bucket_*.state["staging"]` | `acp-stg-tfstate-<id da conta>` |
| `aws_s3_bucket.state["production"]` e os quatro recursos `aws_s3_bucket_*.state["production"]` | `acp-prod-tfstate-<id da conta>` |
| `aws_iam_openid_connect_provider.github` | ARN do provedor |
| `aws_iam_role.plan` | `acp-ci-plan` |
| `aws_iam_role_policy_attachment.plan_read_only` | `acp-ci-plan/arn:aws:iam::aws:policy/ReadOnlyAccess` |
| `aws_iam_role_policy.plan_deny_data` | `acp-ci-plan:deny-data-read` |
| `aws_iam_role.apply["<env>"]` | `acp-ci-apply-<env>` |
| `aws_iam_role_policy.apply_state["<env>"]` | `acp-ci-apply-<env>:state` |
| `aws_iam_role_policy.apply_deny["<env>"]` | `acp-ci-apply-<env>:deny-guardrails` |

## Verificação sem credenciais

```bash
terraform -chdir=infra/bootstrap init -backend=false -lockfile=readonly
terraform -chdir=infra/bootstrap validate
terraform -chdir=infra/bootstrap test
```

Os testes (`tests/bootstrap.tftest.hcl` e `tests/apply.tftest.hcl`) usam provider simulado. O CI roda `fmt`, `tflint` e `trivy config` neste diretório, mas não `validate` nem `test` (#117). O `terraform test` não enxerga `lifecycle`: o `prevent_destroy` dos buckets, do provedor OIDC e dos papéis `apply` é conferido por leitura.

`.terraform.lock.hcl` é versionado, com os hashes `h1:` de linux_amd64, linux_arm64 e darwin_arm64.
