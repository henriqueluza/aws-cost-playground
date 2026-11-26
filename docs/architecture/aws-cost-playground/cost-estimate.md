# Contrato do resultado do motor de preço

`estimate(design, catalog)` recebe um design já validado e o catálogo da região dele e devolve o custo mensal em USD. O painel de custo (#43) consome este resultado.

- **Origem:** [ADR-0001](ADR-0001-stack.md). Formato do design em [design-document.md](design-document.md); do catálogo em [price-catalog.md](price-catalog.md).
- **Onde mora:** `web/src/features/pricing/model/engine.ts` (função `estimate` e os tipos `CostEstimate`, `BlockCost`, `EdgeCost`, `CostLine`, `CostStatus`, `ChargeKind`, `CostNote`, `CostWarning` e `CostWarningCode`). Importe pelo `index.ts` da feature. Se este texto e o código divergirem, vale o código.
- **Função pura:** não altera as entradas nem faz I/O.

## Campos

| Tipo           | Campo                        | Significado                                                              |
| -------------- | ---------------------------- | ------------------------------------------------------------------------ |
| `CostEstimate` | `total`, `fixed`, `variable` | Custo mensal do design                                                   |
| `CostEstimate` | `blocks`, `edges`            | Um item por bloco e por aresta                                           |
| `CostEstimate` | `warnings`                   | Avisos (`CostWarning`: `code` e `blockId`), na ordem de `design.blocks`  |
| `BlockCost`    | `blockId`, `blockType`       | `Block.id` e `Block.type` do design                                      |
| `EdgeCost`     | `edgeId`, `kind`             | `Edge.id` e tipo da aresta                                               |
| item           | `status`                     | `priced` ou `unavailable` (`CostStatus`)                                 |
| item           | `total`, `fixed`, `variable` | Custo mensal do item                                                     |
| item           | `lines`                      | Cobranças (`CostLine`) que somam o item                                  |
| `BlockCost`    | `note`                       | `CostNote`, só em bloco `priced` de custo zero; diz por que é zero       |
| `CostLine`     | `sku`                        | SKU do catálogo (`Price.sku`)                                            |
| `CostLine`     | `quantity`                   | Quantidade cobrada no mês, na unidade do SKU, já sem a franquia gratuita |
| `CostLine`     | `unitPrice`, `amount`        | Preço de uma unidade e `quantity × unitPrice`, em USD por mês            |
| `CostLine`     | `charge`                     | `fixed` (cobrado por existir) ou `variable` (cobrado pelo uso)           |

## Invariantes

- `total = fixed + variable`, no item e no design.
- Os totais do design somam só itens `priced`.
- Item `unavailable` (falta preço no catálogo) tem valores zero e fica fora dos totais.
- Preço em faixas gera uma linha por faixa usada.
- `blocks` e `edges` seguem a ordem de `design.blocks` e `design.edges`.
- `Decimal` sai por `toFixed`. Nunca vai a JSON, query key nem estado persistido.

## Algoritmo

Para cada bloco, na ordem de `design.blocks`:

1. `blockPriceInput` ajusta a entrada ao contrato do tipo ([block-contract.md](block-contract.md#função-de-preço)).
2. A função de preço do bloco devolve as `BlockCharge` (SKU, quantidade bruta do mês, `fixed`/`variable`).
3. `createRater(catalog)` aplica as regras do catálogo a cada cobrança e devolve as `CostLine`.

Regras do catálogo, nesta ordem, por cobrança:

1. **Quantidade mínima:** quantidade maior que zero e menor que `minimumQuantity` vira `minimumQuantity`. Zero não cobra mínimo.
2. **Franquia:** desconta `freeTier.quantity`.
3. **Faixas**, sobre a quantidade já sem franquia: `upTo` é cumulativo e inclusivo (quantidade exatamente em `upTo` fica toda na faixa) e a última faixa é aberta. Gera uma `CostLine` por faixa usada, com `amount = quantity × unitPrice` arredondado meio-para-par na 12ª casa, por linha.

Franquia e posição nas faixas são da conta, isto é, do design inteiro:

- Dois blocos que cobram o mesmo SKU (mesmo serviço e mesmo SKU) dividem uma franquia só e somam volume para a faixa seguinte, consumindo na ordem do design.
- Com `pool`, SKUs diferentes (inclusive de serviços diferentes) dividem a mesma franquia. Se as quantidades declaradas no `pool` divergem, vale a menor (lida do catálogo inteiro, não só dos SKUs usados).
- Cobrança que resulta em quantidade zero (uso zero ou tudo coberto pela franquia) gera uma linha com `quantity` 0 e `amount` 0, no preço da faixa corrente, para o SKU aparecer no detalhamento.

Exemplo: Lambda com 3.000.000 de requisições no mês, franquia de 1.000.000 e US$ 0,0000002 por requisição. Cobra-se 3.000.000 - 1.000.000 = 2.000.000, e 2.000.000 × 0,0000002 = US$ 0,40.

## Item `unavailable`

Sai `unavailable` (valores zero, `lines` vazio, fora dos totais, sem consumir franquia nem faixa) o bloco em que:

- o tipo está fora do contrato;
- um atributo tem valor fora das opções do contrato;
- o serviço da cobrança não está carregado no catálogo;
- o SKU da cobrança não existe no serviço;
- a função de preço devolve quantidade negativa.

Se uma cobrança do bloco não tem preço, o bloco inteiro sai `unavailable`. Todos os blocos saem `unavailable` quando `design.region` difere de `catalog.region`.

## Casos especiais

- **Bloco de custo zero** (nível C: `aws.iam`, `aws.cloudformation`, `aws.ecs`) sai `priced`, com zero, sem linhas e com `note` dizendo o motivo. Vale com ou sem catálogo carregado: não depende de arquivo de preço (não existe arquivo para `iam`, `cloudformation` nem `ecs`). A função de preço vem de `zeroCostPricer` (`model/zeroCost.ts`), que carrega a regra `ZeroCostRule`.
  - `no-direct-cost` (IAM e CloudFormation): a AWS não cobra pelos recursos que o produto modela. `note` é `{ kind: 'no-direct-cost' }`.
  - `billed-on-host` (ECS): modo EC2; o custo está nas instâncias EC2 ligadas por `runs-on`. `note` é `{ kind: 'billed-on-host', hostBlockIds }`, com os ids dos hosts na ordem de `design.edges`, sem repetição. Só conta `runs-on` que parte do ECS e chega a um `aws.ec2`.
  - ECS sem essa aresta não é erro: `hostBlockIds` vem vazio e `warnings` ganha `{ code: 'missing-runs-on', blockId }`.
  - Fargate não é modelado (o PRD o lista em "blocos de expansão", fora do MVP).
- `warnings` não depende do catálogo: o aviso sai mesmo com o bloco `unavailable` (por exemplo, região diferente da do catálogo).
- Arestas saem `priced` com zero e sem linhas até a #42.
- A classificação fixo/variável vem do `charge` de cada `BlockCharge`; `fixed` e `variable` do item somam as linhas de cada tipo.

## Testes

`createEstimator(blocks: BlockPricing)` monta o motor sobre um registro de blocos e existe para testá-lo com funções de preço de teste. `estimate` é o `createEstimator` ligado ao registro real (`blockRegistry.ts`). `createEstimator` não é exportado pelo `index.ts`.
