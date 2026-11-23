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

Os papéis `apply-staging` e `apply-production` chegam na #124 e o papel `prices` na #125.

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
- A negação de `ssm:GetParameter*` impede o `plan` de reler um `aws_ssm_parameter` gerenciado. Com isso o job `plan` falha no refresh de `/acp/<env>/anthropic-api-key` enquanto o autor não decidir a #126: criar o parâmetro à mão, fora do Terraform; planejar sem refresh desse recurso; ou aceitar que o papel `plan` leia a chave.

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

## Verificação sem credenciais

```bash
terraform -chdir=infra/bootstrap init -backend=false -lockfile=readonly
terraform -chdir=infra/bootstrap validate
terraform -chdir=infra/bootstrap test
```

Os testes (`tests/bootstrap.tftest.hcl`) usam provider simulado. O CI roda `fmt`, `tflint` e `trivy config` neste diretório, mas não `validate` nem `test` (#117). O `terraform test` não enxerga `lifecycle`: o `prevent_destroy` dos buckets e do provedor OIDC é conferido por leitura.

`.terraform.lock.hcl` é versionado, com os hashes `h1:` de linux_amd64, linux_arm64 e darwin_arm64.
