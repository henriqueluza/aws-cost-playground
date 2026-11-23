# Módulo `database`

A tabela única do DynamoDB descrita no `docs/architecture/aws-cost-playground/ADR-0001-stack.md` ("Modelo de dados").

| Característica | Valor |
|---|---|
| Cobrança | On-demand (`PAY_PER_REQUEST`), sem capacidade provisionada |
| Chaves | `PK` (partição) e `SK` (ordenação), ambas string |
| Índices secundários | Nenhum |
| TTL | Ligado no atributo `ttl` (itens de quota) |
| Criptografia em repouso | Chave de propriedade da AWS, padrão do serviço, sem custo de KMS |
| Proteção contra exclusão | Sempre ligada, mais `lifecycle { prevent_destroy = true }` |
| PITR | Controlado por variável; ligado por padrão |

As tags vêm do `default_tags` do provider de cada ambiente.

## Uso

```hcl
module "database" {
  source = "../../modules/database"

  name                           = "acp-prod-main"
  point_in_time_recovery_enabled = true
}
```

## Entradas

| Nome | Tipo | Padrão | Descrição |
|---|---|---|---|
| `name` | `string` | obrigatório | Nome da tabela. Aceita só `acp-stg-<componente>` ou `acp-prod-<componente>` |
| `point_in_time_recovery_enabled` | `bool` | `true` | Liga o PITR. Produção mantém ligado; staging passa `false` |

## Saídas

| Nome | Descrição |
|---|---|
| `table_name` | Nome da tabela, para a configuração das funções |
| `table_arn` | ARN da tabela, para as políticas IAM das funções |

## Remover a tabela

O plano falha enquanto houver `prevent_destroy`, e a API recusa a exclusão enquanto a proteção estiver ligada. Remover de propósito segue a ordem do ADR ("Travas contra destruição"): PR que tira o `prevent_destroy`, label `infra:destroy-approved` do autor, e o autor apaga a tabela à mão.

## Testes

Os testes usam provider simulado (`mock_provider`): não precisam de credenciais nem chamam a AWS.

```bash
terraform -chdir=infra/modules/database init -backend=false
terraform -chdir=infra/modules/database validate
terraform -chdir=infra/modules/database test
```

O `init` cria um `.terraform.lock.hcl` na pasta do módulo. Não o versione: o lockfile fica só nos ambientes.
