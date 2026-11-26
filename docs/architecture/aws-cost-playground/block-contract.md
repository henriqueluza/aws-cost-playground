# Contrato dos blocos e das arestas

`contracts/blocks.json` diz o que cada um dos 20 blocos aceita (atributos do SKU e chaves de uso). `contracts/edges.json` diz quais tipos de aresta existem, o uso de cada um e quais pares de blocos podem se ligar. A API (#10, Pydantic) lê os mesmos arquivos, então quem mudar um lado muda o outro junto.

- **Origem:** [ADR-0001](ADR-0001-stack.md) e o PRD (F2, F10 a F12). O design que referencia estes tipos está em [design-document.md](design-document.md); o catálogo de preços, em [price-catalog.md](price-catalog.md); o resultado do motor, em [cost-estimate.md](cost-estimate.md).
- **Onde mora:** os dados em `contracts/blocks.json` e `contracts/edges.json`; os schemas zod (`blocksFileSchema`, `edgesFileSchema`), `PRD_BLOCK_LEVELS`, `BLOCK_TYPES`, `BLOCK_CATEGORIES`, `BLOCK_CONTRACT_LIMITS`, os tipos (`BlockDefinition`, `AttributeDefinition`, `UsageKeyDefinition`, `EdgeKindDefinition`) e a assinatura da função de preço (`BlockPricer`, `BlockPriceInput`, `BlockCharge`) em `web/src/features/pricing/model/blockContract.ts`; o registro (`BLOCKS`, `blockDefinition`, `blockPricer`, `edgeKindsFor`) em `blockRegistry.ts` e as funções de preço em `blocks/<bloco>.ts`. Se este texto e o código divergirem, vale o código.
- **Estado:** a #175 (parte 1 de #9) traz `edges.json` e o contrato em código. A #176 (parte 2 de #9) traz o registro de blocos e os 11 blocos de nível A em `blocks.json`. A #177 (parte 3 de #9) traz os 9 de nível B e C: os 20 blocos do PRD estão em `blocks.json` e a #9 fecha.

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

## Registro de blocos

`web/src/features/pricing/model/blockRegistry.ts` carrega `contracts/blocks.json` e `contracts/edges.json` e valida os dois com os schemas zod na carga do módulo: arquivo inválido derruba o import, não chega à tela. Exporta:

- `BLOCKS`: as definições de `blocks.json`.
- `EDGE_KIND_DEFINITIONS`: as definições de `edges.json`.
- `blockDefinition(type)`: a definição do tipo, ou `undefined` se o tipo não está no contrato.
- `blockPricer(type)`: a função de preço do tipo, ou `undefined` se o tipo não está no contrato.
- `edgeKindsFor(sourceType, targetType)`: os tipos de aresta aceitos entre dois tipos de bloco (`targetType` pode ser `client`), na ordem de `edges.json`.

`edgeKindsFor` devolve lista vazia quando origem ou destino é um tipo fora do contrato. Com `aws.ecs` em `blocks.json`, `edgeKindsFor('aws.ecs', 'aws.ec2')` devolve `['data', 'runs-on']`.

`BLOCK_PRICERS` é `Readonly<Record<BlockType, BlockPricer>>`, completo: o compilador recusa bloco do PRD sem função de preço. As funções dos 20 blocos são provisórias e devolvem `[]`; as regras reais chegam nas Issues de preço (#30 a #41).

Para acrescentar um bloco:

1. Uma entrada em `contracts/blocks.json`.
2. Um arquivo `web/src/features/pricing/model/blocks/<bloco>.ts` com a função de preço.
3. Uma linha em `web/src/features/pricing/model/blocks/index.ts`.

## Blocos de nível A

Valores copiados de `contracts/blocks.json`. Atributo sem `default` é opcional.

### Atributos

| Bloco | Atributo | Opções | Padrão |
| ----- | -------- | ------ | ------ |
| `aws.lambda` | `architecture` | `x86_64`, `arm64` | `arm64` |
| `aws.lambda` | `memoryMb` | `128`, `256`, `512`, `1024`, `2048`, `4096`, `8192`, `10240` | `512` |
| `aws.s3` | `storageClass` | `STANDARD`, `STANDARD_IA` | `STANDARD` |
| `aws.sqs` | `queueType` | `standard`, `fifo` | `standard` |
| `aws.dynamodb` | `capacityMode` | `on-demand`, `provisioned` | `on-demand` |
| `aws.ec2` | `instanceType` | `t3.micro`, `t3.small`, `t3.medium`, `t3.large`, `t4g.micro`, `t4g.small`, `t4g.medium`, `m5.large`, `m5.xlarge`, `c5.large`, `r5.large` | `t3.small` |
| `aws.ec2` | `az` | `a`, `b`, `c` | sem padrão (opcional) |
| `aws.rds` | `engine` | `postgres`, `mysql` | `postgres` |
| `aws.rds` | `instanceClass` | `db.t3.micro`, `db.t3.small`, `db.t3.medium`, `db.t4g.micro`, `db.t4g.small`, `db.t4g.medium`, `db.m5.large`, `db.r5.large` | `db.t3.micro` |
| `aws.rds` | `deployment` | `single-az`, `multi-az` | `single-az` |
| `aws.rds` | `az` | `a`, `b`, `c` | sem padrão (opcional) |
| `aws.elasticache` | `engine` | `redis`, `memcached` | `redis` |
| `aws.elasticache` | `nodeType` | `cache.t3.micro`, `cache.t3.small`, `cache.t3.medium`, `cache.t4g.micro`, `cache.t4g.small`, `cache.t4g.medium`, `cache.m5.large`, `cache.r5.large` | `cache.t3.micro` |
| `aws.elasticache` | `az` | `a`, `b`, `c` | sem padrão (opcional) |

### Chaves de uso

| Bloco | Chave | Unidade | Padrão | Mínimo | Máximo | Inteiro |
| ----- | ----- | ------- | ------ | ------ | ------ | ------- |
| `aws.lambda` | `requestsPerMonth` | requests | `1000000` | `0` | `100000000000` | sim |
| `aws.lambda` | `avgDurationMs` | ms | `120` | `1` | `900000` | sim |
| `aws.s3` | `storageGb` | GB | `50` | `0` | `10000000` | não |
| `aws.s3` | `putRequestsPerMonth` | requests | `100000` | `0` | `100000000000` | sim |
| `aws.s3` | `getRequestsPerMonth` | requests | `1000000` | `0` | `100000000000` | sim |
| `aws.sqs` | `requestsPerMonth` | requests | `1000000` | `0` | `100000000000` | sim |
| `aws.dynamodb` | `readRequestsPerMonth` | requests | `1000000` | `0` | `100000000000` | sim |
| `aws.dynamodb` | `writeRequestsPerMonth` | requests | `500000` | `0` | `100000000000` | sim |
| `aws.dynamodb` | `storageGb` | GB | `5` | `0` | `1000000` | não |
| `aws.dynamodb` | `provisionedReadUnits` | RCU | `5` | `0` | `100000` | sim |
| `aws.dynamodb` | `provisionedWriteUnits` | WCU | `5` | `0` | `100000` | sim |
| `aws.ec2` | `instanceCount` | instances | `1` | `1` | `1000` | sim |
| `aws.ec2` | `hoursPerMonth` | hours | `730` | `0` | `744` | não |
| `aws.ec2` | `rootVolumeGb` | GB | `30` | `8` | `16384` | sim |
| `aws.rds` | `storageGb` | GB | `20` | `20` | `65536` | sim |
| `aws.rds` | `backupStorageGb` | GB | `20` | `0` | `1000000` | não |
| `aws.elasticache` | `nodeCount` | nodes | `1` | `1` | `500` | sim |
| `aws.cloudfront` | `requestsPerMonth` | requests | `1000000` | `0` | `100000000000` | sim |
| `aws.alb` | `newConnectionsPerSecond` | connections/s | `10` | `0` | `1000000` | não |
| `aws.alb` | `activeConnectionsPerMinute` | connections/min | `1000` | `0` | `100000000` | não |
| `aws.alb` | `processedGbPerMonth` | GB | `100` | `0` | `100000000` | não |
| `aws.alb` | `ruleEvaluationsPerSecond` | evaluations/s | `0` | `0` | `10000000` | não |
| `aws.cloudwatch` | `logsIngestedGbPerMonth` | GB | `5` | `0` | `10000000` | não |
| `aws.cloudwatch` | `logsStoredGb` | GB | `5` | `0` | `100000000` | não |
| `aws.cloudwatch` | `customMetrics` | metrics | `10` | `0` | `1000000` | sim |
| `aws.cloudwatch` | `alarms` | alarms | `10` | `0` | `100000` | sim |
| `aws.nat-gateway` | `processedGbPerMonth` | GB | `100` | `0` | `100000000` | não |

## Blocos de nível B e C

Valores copiados de `contracts/blocks.json`, no mesmo formato. Atributo sem `default` é opcional. Blocos de B e C sem atributo (`aws.waf`, `aws.secrets-manager`, `aws.cloudtrail`, `aws.route53`, `aws.iam`, `aws.cloudformation`) não aparecem na tabela de atributos.

- Os três de nível C (`aws.iam`, `aws.cloudformation`, `aws.ecs`) custam zero e não têm chave de uso.
- `aws.ecs` leva só o atributo opcional `az` (`a`, `b`, `c`, sem padrão). O custo dele vem do EC2 ligado pela aresta `runs-on`.
- Em `aws.codepipeline`, as chaves `activePipelines` e `executionMinutesPerMonth` convivem no bloco. Qual delas cada tipo de pipeline usa é definido pela função de preço (#40), não por este contrato.
- Em `aws.cloudtrail`, `trails` é o número de trilhas: a cobrança dos eventos de gerenciamento "além da primeira trilha" (#40) sai dele.

### Atributos

| Bloco | Atributo | Opções | Padrão |
| ----- | -------- | ------ | ------ |
| `aws.cognito` | `tier` | `lite`, `essentials`, `plus` | `essentials` |
| `aws.codepipeline` | `pipelineType` | `V1`, `V2` | `V2` |
| `aws.ecs` | `az` | `a`, `b`, `c` | sem padrão (opcional) |

### Chaves de uso

| Bloco | Chave | Unidade | Padrão | Mínimo | Máximo | Inteiro |
| ----- | ----- | ------- | ------ | ------ | ------ | ------- |
| `aws.waf` | `webAcls` | web ACLs | `1` | `1` | `100` | sim |
| `aws.waf` | `rules` | rules | `5` | `0` | `10000` | sim |
| `aws.waf` | `requestsPerMonth` | requests | `1000000` | `0` | `100000000000` | sim |
| `aws.cognito` | `monthlyActiveUsers` | users | `1000` | `0` | `100000000` | sim |
| `aws.secrets-manager` | `secrets` | secrets | `5` | `0` | `100000` | sim |
| `aws.secrets-manager` | `apiCallsPerMonth` | requests | `100000` | `0` | `100000000000` | sim |
| `aws.cloudtrail` | `trails` | trails | `1` | `1` | `5` | sim |
| `aws.cloudtrail` | `managementEventsPerMonth` | events | `100000` | `0` | `100000000000` | sim |
| `aws.cloudtrail` | `dataEventsPerMonth` | events | `0` | `0` | `100000000000` | sim |
| `aws.route53` | `hostedZones` | hosted zones | `1` | `1` | `500` | sim |
| `aws.route53` | `queriesPerMonth` | queries | `1000000` | `0` | `100000000000` | sim |
| `aws.codepipeline` | `activePipelines` | pipelines | `1` | `0` | `1000` | sim |
| `aws.codepipeline` | `executionMinutesPerMonth` | minutes | `500` | `0` | `10000000` | não |

## Tipos dos blocos e nível

Nível de preço do PRD (F10 a F12); `C` é custo zero.

| Nível | Tipos                                                                                                                     |
| ----- | ------------------------------------------------------------------------------------------------------------------------- |
| A     | `aws.ec2`, `aws.lambda`, `aws.rds`, `aws.dynamodb`, `aws.elasticache`, `aws.s3`, `aws.sqs`, `aws.cloudfront`, `aws.alb`, `aws.cloudwatch`, `aws.nat-gateway` |
| B     | `aws.waf`, `aws.cognito`, `aws.secrets-manager`, `aws.cloudtrail`, `aws.route53`, `aws.codepipeline`                       |
| C     | `aws.iam`, `aws.cloudformation`, `aws.ecs`                                                                                |

Os de nível A entraram em `blocks.json` na #176; os de B e C, na #177. Os 20 estão no arquivo.

## Função de preço

Cada bloco tem uma função pura (`BlockPricer`), sem I/O: recebe `BlockPriceInput` e devolve `readonly BlockCharge[]`, o que cobrar, sem o valor em dólar.

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
