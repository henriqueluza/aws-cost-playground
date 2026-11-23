# Módulo `functions`

As duas funções Lambda da API, os papéis IAM, os log groups e o parâmetro da chave da Claude API, conforme o `docs/architecture/aws-cost-playground/ADR-0001-stack.md` ("Hospedagem e ambientes").

| Característica | Valor |
|---|---|
| Funções | `acp-<stg\|prod>-api` (timeout 10 s) e `acp-<stg\|prod>-llm-proxy` (timeout 29 s), do mesmo pacote zip |
| Runtime | Python 3.13, `arm64`, 256 MB fixos |
| Logs | Formato JSON; um log group por função, criado pelo Terraform, com retenção por variável (padrão 7 dias; aceita 1, 3, 5, 7, 14 ou 30) |
| Papéis IAM | Um por função, com o mesmo nome dela, e políticas inline sem curinga em ação ou recurso |
| Parâmetro da chave | `/acp/<env>/anthropic-api-key`, `SecureString`, `prevent_destroy` |

As tags vêm do `default_tags` do provider de cada ambiente.

## Uso

```hcl
module "functions" {
  source = "../../modules/functions"

  environment        = "production"
  table_arn          = module.database.table_arn
  user_pool_arn      = "arn:aws:cognito-idp:us-east-1:123456789012:userpool/us-east-1_example"
  package_bucket     = "acp-artifacts-example"
  package_key        = "functions/<sha-do-commit>.zip"
  api_handler        = "app.main.handler"
  llm_proxy_handler  = "app.llm_proxy.handler"
  log_retention_days = 7
  llm_enabled        = true
}
```

## Entradas

| Nome | Tipo | Padrão | Descrição |
|---|---|---|---|
| `environment` | `string` | obrigatório | `staging` ou `production`. Define o prefixo (`acp-stg`, `acp-prod`) e o caminho do parâmetro |
| `table_arn` | `string` | obrigatório | ARN completo da tabela (saída do módulo `database`). O nome da tabela sai dele |
| `user_pool_arn` | `string` | obrigatório | ARN completo do User Pool do Cognito. O id do pool sai dele |
| `package_bucket` | `string` | obrigatório | Bucket de artefatos onde o CI guarda o zip |
| `package_key` | `string` | obrigatório | Chave do zip no bucket, por SHA do commit. As duas funções usam o mesmo pacote |
| `api_handler` | `string` | obrigatório | Handler da `api` dentro do pacote |
| `llm_proxy_handler` | `string` | obrigatório | Handler do `llm-proxy` dentro do pacote |
| `log_retention_days` | `number` | `7` | Retenção dos log groups. Só 1, 3, 5, 7, 14 ou 30 |
| `llm_enabled` | `bool` | `false` | Valor de `LLM_ENABLED` do `llm-proxy`. Quem esquecer a variável fica com a LLM desligada |

## Saídas

| Nome | Descrição |
|---|---|
| `function_names` | Nome de cada função, por chave (`api`, `llm-proxy`) |
| `function_invoke_arns` | ARN de invocação de cada função, para as integrações do API Gateway |
| `role_names` | Nome do papel de cada função. O do `llm-proxy` é o alvo da ação de corte do Budgets |
| `api_key_parameter_name` | Nome do parâmetro da chave. Só o nome: o valor nunca passa pelo Terraform |

## Variáveis de ambiente das funções

Nenhum segredo vai em variável de ambiente.

| Função | Variáveis |
|---|---|
| `api` | `TABLE_NAME`, `USER_POOL_ID` |
| `llm-proxy` | `TABLE_NAME`, `LLM_ENABLED`, `ANTHROPIC_API_KEY_PARAMETER` (só o **nome** do parâmetro; o proxy lê o valor em execução) |

## Permissões

| Papel | Permissões |
|---|---|
| `api` | `dynamodb:GetItem`, `PutItem`, `DeleteItem`, `Query` e `BatchWriteItem` na tabela, restritas por `dynamodb:LeadingKeys` às partições `USER#*`; `cognito-idp:AdminDeleteUser` no pool. Não lê o parâmetro |
| `llm-proxy` | `dynamodb:GetItem` e `UpdateItem` na tabela (o `TransactWriteItems` da quota é autorizado pela ação `UpdateItem`); `ssm:GetParameter` só no parâmetro da chave |
| Ambos | `logs:CreateLogStream` e `logs:PutLogEvents` só no próprio log group. Sem `logs:CreateLogGroup`: o Terraform já criou o grupo |

## Parâmetro da chave

O parâmetro `/acp/<env>/anthropic-api-key` é `SecureString`, cifrado com a chave gerenciada `aws/ssm` (sem custo de KMS). O módulo o cria com um valor de espera pelo argumento write-only `value_wo` (com `value_wo_version = 1`); o autor grava a chave real à mão, pelo console ([rotação de segredos](../../../docs/runbooks/rotacao-de-segredos.md)).

- `lifecycle` tem `ignore_changes` em `value_wo` e `value_wo_version`, e `prevent_destroy`.
- O valor, o de espera e o real, nunca entra no plano nem no state, nem depois do refresh.
- **Limite:** o refresh do provider ainda chama `ssm:GetParameter` com decifragem. O valor passa pela memória do runner, mas não é gravado. Por isso os papéis de CI `plan` e `apply-*` (`infra/bootstrap/`, Issue #13) precisam de `ssm:GetParameter` nesse parâmetro. É uma diferença em relação ao ADR, que diz que só o papel do `llm-proxy` lê o parâmetro; em execução isso continua valendo.
- **Nunca aumente `value_wo_version` nem remova o `ignore_changes`:** o `apply` regravaria o valor de espera por cima da chave real.
- Enquanto o valor for o de espera, o `llm-proxy` precisa falhar fechado. Isso é do código do proxy, não deste módulo.

## O que o módulo deixa em paz

Itens de configuração de custo que o autor faz à mão ([guardrails de custo](../../../docs/runbooks/guardrails-de-custo.md), "Drift com o Terraform"):

- `reserved_concurrent_executions` das funções está em `ignore_changes`: o `apply` não desfaz a concorrência reservada.
- Os papéis não usam anexação exclusiva de políticas (só `aws_iam_role_policy` inline): o `apply` não remove a política `acp-llm-proxy-corte` que o Budgets anexa ao papel do proxy.
- O nome do papel do proxy é estável (`acp-<stg|prod>-llm-proxy`), pois a ação do Budgets aponta para ele.

Fora do módulo: API Gateway e a permissão de invocação (#19), alarmes (#20), composição nos ambientes (#21) e a concorrência reservada (manual).

## Remover o parâmetro

O plano falha enquanto houver `prevent_destroy`. Remover de propósito segue a ordem do ADR ("Travas contra destruição"): PR que tira o `prevent_destroy`, label `infra:destroy-approved` do autor, e o autor aplica. A chave real é perdida; guarde-a antes se for preciso.

## Testes

Os testes usam provider simulado (`mock_provider`): não precisam de credenciais nem chamam a AWS.

```bash
terraform -chdir=infra/modules/functions init -backend=false
terraform -chdir=infra/modules/functions validate
terraform -chdir=infra/modules/functions test
```

O `init` cria um `.terraform.lock.hcl` na pasta do módulo. Não o versione: o lockfile fica só nos ambientes.
