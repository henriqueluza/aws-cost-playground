# Módulo `functions`

As duas funções Lambda da API, os papéis IAM e os log groups, conforme o `docs/architecture/aws-cost-playground/ADR-0001-stack.md` ("Hospedagem e ambientes").

| Característica | Valor |
|---|---|
| Funções | `acp-<stg\|prod>-api` (timeout 10 s) e `acp-<stg\|prod>-llm-proxy` (timeout 29 s), do mesmo pacote zip |
| Runtime | Python 3.14, `arm64`, 256 MB fixos |
| Logs | Formato JSON; um log group por função, criado pelo Terraform, com retenção por variável (padrão 7 dias; aceita 1, 3, 5, 7, 14 ou 30) |
| Papéis IAM | Um por função, com o mesmo nome dela, políticas inline sem curinga em ação ou recurso, limite de permissões (`acp-ci-boundary-<env>`) e `prevent_destroy` |
| Parâmetro da chave | `/acp/<env>/anthropic-api-key`. **Fora do Terraform:** o autor o cria à mão; o módulo só usa o nome |

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
| `api_key_parameter_name` | Nome do parâmetro da chave, que o autor cria à mão. O parâmetro e o valor ficam fora do Terraform |

## Runtime e pacote

O runtime (`python3.14`, Amazon Linux 2023) acompanha `api/.python-version`. O zip é montado por `scripts/build-functions.sh` para essa versão e para `aarch64-manylinux_2_28` (arm64), só com wheels binárias (`--only-binary :all:`); a glibc 2.34 do runtime aceita essas wheels. A AWS lista `python3.14` entre os runtimes que aceitam `arm64` ([Lambda runtimes](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html)).

- Trocar o Python da API exige trocar `api/.python-version` e o `runtime` no mesmo PR. O teste `infra/tools/tests/test_functions_runtime.py` reprova a divergência e confere os parâmetros do script de build.
- Trocar o runtime é alteração in-place da função: ela não é recriada.

## Variáveis de ambiente das funções

Nenhum segredo vai em variável de ambiente.

| Função | Variáveis |
|---|---|
| `api` | `TABLE_NAME`, `USER_POOL_ID` |
| `llm-proxy` | `TABLE_NAME`, `LLM_ENABLED`, `ANTHROPIC_API_KEY_PARAMETER` (só o **nome** do parâmetro; o proxy lê o valor em execução) |

## Permissões

| Papel | Permissões |
|---|---|
| `api` | `dynamodb:GetItem`, `PutItem`, `UpdateItem` (trava otimista dos designs, #54), `DeleteItem`, `Query` e `BatchWriteItem` na tabela, restritas por `dynamodb:LeadingKeys` às partições `USER#*`; `cognito-idp:AdminDeleteUser` no pool. Não lê o parâmetro |
| `llm-proxy` | `dynamodb:GetItem` e `UpdateItem` na tabela (o `TransactWriteItems` da quota é autorizado pela ação `UpdateItem`), limitadas às partições `USER#*` e `GLOBAL` e às colunas dos contadores (ver "Condição da quota"); `ssm:GetParameter` só no parâmetro da chave |
| Ambos | `logs:CreateLogStream` e `logs:PutLogEvents` só no próprio log group. Sem `logs:CreateLogGroup`: o Terraform já criou o grupo |

## Condição da quota

A declaração `Quota` do `llm-proxy` segue o exemplo 6 de [Using IAM policy conditions for fine-grained access control](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/specifying-conditions.html):

| Condição | Efeito |
|---|---|
| `ForAllValues:StringLike` em `dynamodb:LeadingKeys` = `USER#*`, `GLOBAL` | Só as partições que o proxy usa. Numa transação, o DynamoDB autoriza cada item em separado, com a ação e a chave de partição dele |
| `Null` em `dynamodb:LeadingKeys` = `false` | A requisição precisa trazer chave de partição (`ForAllValues` vale verdadeiro quando a chave falta) |
| `ForAllValues:StringEquals` em `dynamodb:Attributes` = `PK`, `SK`, `count`, `ttl` | Só as colunas do contador podem ser lidas, escritas ou usadas em condição. As chaves entram porque a AWS exige |
| `StringEqualsIfExists` em `dynamodb:Select` = `SPECIFIC_ATTRIBUTES` e `dynamodb:ReturnValues` = `NONE` | `GetItem` sem projeção é negado e nenhuma escrita devolve o item |

- **O que a condição reduz.** Os designs ficam na mesma partição `USER#<sub>` dos contadores, e a política não conhece o `sub`. `LeadingKeys` sozinha, com o modelo de dados de hoje, não tira nada do papel: quem separa quota de design é a lista de colunas. Com ela, um defeito no proxy não lê nem altera `doc`, `name` nem as outras colunas de um design.
- **O que sobra.** O proxy ainda consegue somar `count` ou gravar `ttl` em qualquer item de `USER#*` ou `GLOBAL` cuja chave completa ele conheça (ele não tem `Query` para descobri-la). Um `ttl` gravado num design faria o DynamoDB expirá-lo. Fechar isso exigiria os contadores numa partição ou tabela própria, o que muda o modelo de dados do ADR.
- **Quem muda `api/app/quotas/repository.py` muda a lista.** Coluna nova, `GetItem` sem `ProjectionExpression` ou `ReturnValues` são negados em execução, sem erro no plano. `infra/tools/tests/test_quota_policy.py` compara os dois lados.
- **Só o staging prova.** A documentação afirma a autorização item a item da transação para `LeadingKeys`; para `Attributes`, a referência de autorização lista a chave na ação `UpdateItem`, mas não há exemplo com transação. O primeiro deploy de staging precisa de uma estimativa (`POST /estimates`) e de um `GET /quota` com sucesso. Se o DynamoDB negar, o proxy responde indisponível (falha fechada: nenhuma chamada à LLM) e o log registra a quota indisponível, com `AccessDeniedException` no caso da transação. A volta é remover da declaração a linha de `dynamodb:Attributes` e a de `StringEqualsIfExists`.

## Limite de permissões

Os dois papéis levam `permissions_boundary = arn:aws:iam::<conta>:policy/acp-ci-boundary-<staging|production>`. O sufixo é o nome completo do ambiente (igual a `local.apply_boundary_arn` em `infra/bootstrap/apply.tf`) e a conta sai de `table_arn`. Não há variável nova. Os papéis de CI `acp-ci-apply-<env>` negam `iam:CreateRole` e `iam:PutRolePolicy` em papel sem esse limite.

- A política nasce no bootstrap (#166), não neste módulo. Ela precisa existir antes do primeiro `apply`; sem ela o `apply` falha com política inexistente ou `AccessDenied`.
- O limite não concede nada: a permissão efetiva é a interseção entre as políticas inline e o limite.
- Permissão nova numa função exige ajustar primeiro o limite no bootstrap e depois a lista do teste `politicas_inline_cabem_no_limite`. Ação fora do limite é negada em execução, sem erro no plano.
- Pôr o limite num papel que já existe é alteração in-place (`iam:PutRolePermissionsBoundary`). O papel não é recriado, então o `prevent_destroy` não reprova o plano.

## Parâmetro da chave

O parâmetro `/acp/<env>/anthropic-api-key` **não é um recurso do Terraform**. O autor o cria e grava a chave à mão, pelo console ([rotação de segredos](../../../docs/runbooks/rotacao-de-segredos.md), "Criar o parâmetro pela primeira vez").

- O módulo só conhece o **nome**: passa-o ao `llm-proxy` em `ANTHROPIC_API_KEY_PARAMETER` e monta o ARN para a política do papel. Região e conta do ARN saem de `table_arn`.
- Em nenhum momento o valor passa pelo plano, pelo state ou por um runner do CI. Nenhum papel de CI (`plan`, `apply-*`) precisa de `ssm:GetParameter`, e só o papel do `llm-proxy` lê o parâmetro.
- O parâmetro pode ser criado antes ou depois do `apply`: a política aponta para o ARN pelo nome.
- Enquanto o parâmetro não existir, o `llm-proxy` precisa falhar fechado. Isso é do código do proxy, não deste módulo.
- Motivo da escolha (decisão do autor na #126): com o parâmetro no Terraform, o refresh do provider o lê com decifragem, e o papel `plan` roda código de qualquer PR.

## O que o módulo deixa em paz

Itens de configuração de custo que o autor faz à mão ([guardrails de custo](../../../docs/runbooks/guardrails-de-custo.md), "Drift com o Terraform"):

- `reserved_concurrent_executions` das funções está em `ignore_changes`: o `apply` não desfaz a concorrência reservada.
- Os papéis não usam anexação exclusiva de políticas (só `aws_iam_role_policy` inline): o `apply` não remove a política `acp-llm-proxy-corte` que o Budgets anexa ao papel do proxy.
- O nome do papel do proxy é estável (`acp-<stg|prod>-llm-proxy`), pois a ação do Budgets aponta para ele.

Fora do módulo: API Gateway e a permissão de invocação (#19), alarmes (#20), composição nos ambientes (#21) e a concorrência reservada (manual).

## Remover um papel

O plano falha enquanto houver `prevent_destroy` nos papéis. Remover de propósito segue a ordem do ADR ("Travas contra destruição"): PR que tira o `prevent_destroy`, label `infra:destroy-approved` do autor, e o autor aplica. Depois, reanexe a política de corte do Budgets ao papel novo do proxy.

## Testes

Os testes usam provider simulado (`mock_provider`): não precisam de credenciais nem chamam a AWS.

```bash
terraform -chdir=infra/modules/functions init -backend=false
terraform -chdir=infra/modules/functions validate
terraform -chdir=infra/modules/functions test
python3 -m unittest discover -s infra/tools/tests   # runtime alinhado ao Python da API
```

O `init` cria um `.terraform.lock.hcl` na pasta do módulo. Não o versione: o lockfile fica só nos ambientes.
