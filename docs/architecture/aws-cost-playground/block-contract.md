# Contrato dos blocos e das arestas

`contracts/blocks.json` diz o que cada um dos 20 blocos aceita (atributos do SKU e chaves de uso). `contracts/edges.json` diz quais tipos de aresta existem, o uso de cada um e quais pares de blocos podem se ligar. A API (#10, Pydantic) lê os mesmos arquivos, então quem mudar um lado muda o outro junto.

- **Origem:** [ADR-0001](ADR-0001-stack.md) e o PRD (F2, F10 a F12). O design que referencia estes tipos está em [design-document.md](design-document.md); o catálogo de preços, em [price-catalog.md](price-catalog.md); o resultado do motor, em [cost-estimate.md](cost-estimate.md).
- **Onde mora:** os dados em `contracts/blocks.json` e `contracts/edges.json`; os schemas zod (`blocksFileSchema`, `edgesFileSchema`), `PRD_BLOCK_LEVELS`, `BLOCK_TYPES`, `BLOCK_CATEGORIES`, `BLOCK_CONTRACT_LIMITS`, os tipos (`BlockDefinition`, `AttributeDefinition`, `UsageKeyDefinition`, `EdgeKindDefinition`) e a assinatura da função de preço (`BlockPricer`, `BlockPriceInput`, `BlockCharge`) em `web/src/features/pricing/model/blockContract.ts`. Se este texto e o código divergirem, vale o código.
- **Estado:** a #175 (parte 1 de #9) traz `edges.json` e o contrato em código. `blocks.json` e o registro de blocos (`blockRegistry.ts`, `blocks/*.ts`) ainda não existem: chegam nas Issues #176 (11 blocos de nível A) e #177 (9 de nível B e C, fecha a #9).

## `contracts/blocks.json`

Raiz: `{ "schemaVersion": 1, "blocks": [...] }`, no máximo um item por tipo de bloco.

| Campo                | Regra                                                                                                                                         |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`               | Um dos 20 tipos da tabela abaixo. Tipo repetido é recusado.                                                                                   |
| `name`               | Nome do serviço, em inglês, de 1 a 40 caracteres.                                                                                             |
| `category`           | `compute`, `storage`, `database`, `networking`, `integration`, `security`, `management` ou `devtools` (nomes das categorias da própria AWS). |
| `level`              | `A`, `B` ou `C`, igual ao de `PRD_BLOCK_LEVELS` para o `type`.                                                                                |
| `attributes[]`       | Atributos do SKU. Até 32, chaves únicas.                                                                                                      |
| `attributes[].key`   | camelCase `^[a-z][A-Za-z0-9]{0,39}$`, mesma regra das chaves do design; propriedades de `Object.prototype` são recusadas.                     |
| `attributes[].options` | Conjunto fechado: de 1 a 32 opções, sem repetição. Cada opção é string de 1 a 64 caracteres ou número, todas do mesmo tipo.                                      |
| `attributes[].default` | Opcional, e deve estar em `options`. Sem `default`, o atributo é opcional (caso do `az`).                                                   |
| `usage[]`            | Chaves de uso. Até 32, chaves únicas, mesma regra de `key`.                                                                                   |
| `usage[].unit`       | Unidade, em inglês, de 1 a 40 caracteres.                                                                                                     |
| `usage[].default`, `min`, `max` | Números de 0 a `DESIGN_LIMITS.maxUsageValue` (1e12). Exige `min < max` e `min <= default <= max`.                                  |
| `usage[].integer`    | Se `true`, `default`, `min` e `max` precisam ser inteiros.                                                                                    |

Exemplo (`aws.lambda`):

```json
{
  "type": "aws.lambda",
  "name": "Lambda",
  "category": "compute",
  "level": "A",
  "attributes": [
    {"key": "architecture", "options": ["x86_64", "arm64"], "default": "arm64"},
    {"key": "memoryMb", "options": [128, 256, 512, 1024, 2048, 4096, 8192, 10240], "default": 512}
  ],
  "usage": [
    {"key": "requestsPerMonth", "unit": "requests", "default": 1000000, "min": 0, "max": 100000000000, "integer": true},
    {"key": "avgDurationMs", "unit": "ms", "default": 120, "min": 1, "max": 900000, "integer": true}
  ]
}
```

## `contracts/edges.json`

Raiz: `{ "schemaVersion": 1, "kinds": [...] }`. Cada tipo de aresta (`data`, `runs-on`, `logs`) aparece exatamente uma vez. Cada item tem `kind`, `usage[]` (mesmo formato de `usage[]` dos blocos) e `pairs[]` (de 1 a 32). Uma aresta é aceita se a origem está em `sources` e o destino em `targets` de algum par. `targets` aceita também `client` (a internet), mas só em `data`: `runs-on` e `logs` com `client` no par são recusados.

| `kind`    | Uso                                 | Origem (`sources`)                                                                                                                | Destino (`targets`)                                                              |
| --------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `data`    | `gbPerMonth` (GB, padrão 10)        | Os 15 blocos de tráfego: `route53`, `cloudfront`, `waf`, `alb`, `nat-gateway`, `ec2`, `ecs`, `lambda`, `rds`, `dynamodb`, `elasticache`, `s3`, `sqs`, `cognito`, `secrets-manager` | Os mesmos 15 blocos. Fora: IAM, CloudFormation, CloudWatch, CloudTrail e CodePipeline. |
| `data`    | (mesmo)                             | `cloudfront`, `s3`, `alb`, `ec2`                                                                                                  | `client`                                                                         |
| `runs-on` | nenhum                              | `ecs`                                                                                                                             | `ec2`                                                                            |
| `logs`    | `gbPerMonth` (GB, padrão 10)        | Qualquer bloco, menos `cloudwatch`                                                                                                | `cloudwatch`                                                                     |

`gbPerMonth` vai de 0 a 100.000.000 e aceita fração (`integer: false`). Todos os tipos acima levam o prefixo `aws.`.

## Tipos dos blocos e nível

Nível de preço do PRD (F10 a F12); `C` é custo zero.

| Nível | Tipos                                                                                                                     |
| ----- | ------------------------------------------------------------------------------------------------------------------------- |
| A     | `aws.ec2`, `aws.lambda`, `aws.rds`, `aws.dynamodb`, `aws.elasticache`, `aws.s3`, `aws.sqs`, `aws.cloudfront`, `aws.alb`, `aws.cloudwatch`, `aws.nat-gateway` |
| B     | `aws.waf`, `aws.cognito`, `aws.secrets-manager`, `aws.cloudtrail`, `aws.route53`, `aws.codepipeline`                       |
| C     | `aws.iam`, `aws.cloudformation`, `aws.ecs`                                                                                |

Os de nível A chegam na #176; os de B e C, na #177.

## Função de preço

Cada bloco terá uma função pura (`BlockPricer`), sem I/O: recebe `BlockPriceInput` e devolve `readonly BlockCharge[]`, o que cobrar, sem o valor em dólar.

| Tipo              | Campo                      | Significado                                                           |
| ----------------- | -------------------------- | --------------------------------------------------------------------- |
| `BlockPriceInput` | `attributes`               | Atributos do bloco (`Block['attributes']`), já validados              |
| `BlockPriceInput` | `usage`                    | Uso efetivo (`UsageValues`), já validado                              |
| `BlockCharge`     | `sku`                      | SKU do catálogo (`Price.sku`)                                         |
| `BlockCharge`     | `quantity`                 | Quantidade mensal do SKU (`Decimal`)                                  |
| `BlockCharge`     | `charge`                   | `fixed` ou `variable` (`ChargeKind`, de [cost-estimate.md](cost-estimate.md)) |

**Provisório:** o motor (#26) aplica faixas, franquia gratuita e mínimo do catálogo às `BlockCharge` e monta as `CostLine`. Ele pode estender `BlockPriceInput` (por exemplo, com o catálogo ou o contexto da aresta); a função de cada bloco não muda por isso.

## Convenções

- **Leitura tolerante:** chave desconhecida nos JSON é descartada, não recusada, como no [design do documento](design-document.md#regras). No Pydantic, `extra="ignore"`.
- **Uma linha por atributo e por chave de uso.** Os JSON são formatados à mão: o Prettier do `web/` não alcança `contracts/`.
- **Unidade e `name` em inglês.** O contrato não tem rótulo de UI: os rótulos em pt-BR dos blocos, atributos e chaves de uso são da UI (#48).
- **Sem valor em dólar.** O preço vem só do catálogo; o contrato só diz o que o bloco aceita.
