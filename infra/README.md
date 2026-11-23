# infra

Terraform da AWS (us-east-1, 100% serverless). Decisões em `docs/architecture/aws-cost-playground/ADR-0001-stack.md`.

## Estrutura

| Pasta | Conteúdo |
|---|---|
| `modules/` | Módulos reutilizáveis, cada um com README próprio (hoje: `auth`, `database` e `dns`) |
| `envs/staging` | Raiz do ambiente `staging` |
| `envs/production` | Raiz do ambiente `production` |
| `tools/` | `plan_guard.py` e seus testes |
| `bootstrap/` | Buckets de estado, provedor OIDC e papéis de CI; é do autor e chega na #13. Agentes não tocam |

## Regras para agentes

- Nunca rodar `apply`, `destroy`, `import` nem comandos de estado (`state`, `force-unlock`...).
- Validar só assim:

```bash
terraform -chdir=infra/envs/<env> init -backend=false && terraform -chdir=infra/envs/<env> validate
```

Módulo com testes (`tests/*.tftest.hcl`, provider simulado, sem credenciais): `terraform -chdir=infra/modules/<m> init -backend=false && terraform -chdir=infra/modules/<m> validate && terraform -chdir=infra/modules/<m> test`. O lockfile do módulo não é versionado, e o CI só roda `validate` nos ambientes.

## Backend

Estado no S3 com lock nativo (`use_lockfile`), sem DynamoDB. O nome do bucket **não está no código**: entra no `init` por `-backend-config="bucket=..."`.

| Ambiente | Chave do estado | Variável de repositório (CI) |
|---|---|---|
| staging | `acp-stg/terraform.tfstate` | `TF_STATE_BUCKET_STAGING` |
| production | `acp-prod/terraform.tfstate` | `TF_STATE_BUCKET_PRODUCTION` |

No CI, o papel de leitura vem de `AWS_PLAN_ROLE_ARN`. O workflow `terraform.yml` ainda não existe; chega na #90.

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
