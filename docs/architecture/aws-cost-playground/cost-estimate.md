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
- Os totais do design somam só itens `priced`, blocos e arestas.
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
- Aresta sem custo sai `priced` com zero e sem linhas (veja [Custos de aresta](#custos-de-aresta)).
- A classificação fixo/variável vem do `charge` de cada `BlockCharge`; `fixed` e `variable` do item somam as linhas de cada tipo.

## Custos de aresta

Depois dos blocos, cada aresta de `design.edges`, na ordem do design, vira cobranças (`edgeCharges`, em `model/edgeCharges.ts`) que passam pelo mesmo `createRater` dos blocos. Bloco e aresta que cobram o mesmo SKU dividem franquia e faixas; os blocos consomem primeiro. Toda cobrança de aresta é `variable`. A quantidade vem de `gbPerMonth`, o uso efetivo da aresta (override vence), ajustado a `contracts/edges.json` como o uso dos blocos: ausente recebe o padrão (10 GB) e valor fora da faixa é limitado a ela.

| Aresta                                             | Serviço e SKU do catálogo                      | Quantidade       | Regra da AWS                                                                                                                                               |
| -------------------------------------------------- | ---------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data` com destino `client`, origem S3, ALB ou EC2 | `data-transfer` / `data-transfer-internet-out` | `gbPerMonth`     | Saída da região para a internet: faixas por volume (10 TB, 50 TB, 150 TB) e franquia de 100 GB por mês. Faixas e franquia somam todos os serviços da conta |
| `data` com destino `client`, origem CloudFront     | `cloudfront` / `cloudfront-data-transfer-out`  | `gbPerMonth`     | Saída das bordas do CloudFront: tabela própria por geografia da borda e franquia própria de 1 TB (1.024 GB) por mês                                        |
| `data` com destino `aws.nat-gateway`               | `nat-gateway` / `nat-gateway-data-processed`   | `gbPerMonth`     | GB processado pelo NAT Gateway, o mesmo SKU do `processedGbPerMonth` do bloco                                                                              |
| `data` entre blocos com `az` diferente             | `data-transfer` / `data-transfer-inter-az`     | 2 × `gbPerMonth` | Tráfego entre zonas da mesma região: US$ 0,01 por GB em cada direção (saída de uma zona e entrada na outra)                                                |
| `logs`                                             | `cloudwatch` / `cloudwatch-logs-ingestion`     | `gbPerMonth`     | Ingestão de logs, o mesmo SKU e a mesma franquia do `logsIngestedGbPerMonth` do bloco                                                                      |
| `data` nos outros casos e `runs-on`                | nenhum                                         |                  | Sem custo: `priced`, zero, sem linhas                                                                                                                      |

Premissas e limites:

- **Uma cobrança por aresta.** A ordem da tabela é a de decisão: `client`, depois NAT, depois zonas.
- **Zonas.** Só há cobrança quando as duas pontas têm `az` e eles diferem. Mesma zona, ponta sem `az` ou serviço sem zona (Lambda, S3, ALB, NAT...) não cobra. No RDS Multi-AZ, `az` é a zona da instância primária; a replicação para a zona reserva já está no preço Multi-AZ.
- **Franquias por conta.** Os 100 GB de saída da região valem para S3, ALB e EC2 juntos, por ser um SKU só. O CloudFront não os consome: tem os 1.024 GB dele. O tráfego entre zonas não tem franquia no catálogo.
- **Faixas sobre o volume já sem franquia.** É a regra geral do motor. Na AWS os primeiros 10 TB incluem os 100 GB grátis; a diferença só aparece a menos de 100 GB de uma troca de faixa e é de centavos por GB.
- **CloudFront.** O preço é o das bordas do continente da região do design (Estados Unidos em us-east-1, América do Sul em sa-east-1), decisão da #31.
- **Armazenamento de logs.** A aresta `logs` cobra só a ingestão. O armazenado é o `logsStoredGb` do bloco CloudWatch; a relação de 15% do ingerido em `docs/scenarios.md` é premissa dos cenários, não do motor.
- **Sem contagem dupla.** O volume da aresta não é somado ao uso do bloco de destino: aparece só nas linhas da aresta. `BlockPriceInput` não recebe volume de arestas.
- **Fora:** tráfego entre regiões, a saída para a internet do que passa pelo NAT (o contrato não tem aresta NAT → `client`) e a entrada de dados (gratuita).

Aresta `unavailable` (valores zero, sem linhas, fora dos totais, sem consumir franquia nem faixa):

- fora de `contracts/edges.json`: par origem/destino não aceito para o tipo da aresta, ponta de tipo fora do contrato ou ponta com atributo fora das opções;
- serviço da cobrança não carregado no catálogo, ou SKU ausente nele;
- `design.region` diferente de `catalog.region` (todas as arestas, inclusive as sem custo).

Exemplo: S3 → `client` com 12.388 GB em us-east-1. Cobra-se 12.388 - 100 = 12.288 GB: 10.240 × 0,09 = US$ 921,60 na primeira faixa e 2.048 × 0,085 = US$ 174,08 na segunda, US$ 1.095,68 no total.

`catalogServices(design)` inclui o serviço de cada cobrança de aresta, para o `usePriceCatalog` carregar `data-transfer` (e `cloudfront`, `nat-gateway`, `cloudwatch`) mesmo quando nenhum bloco o pede.

## Apresentação no painel

Camada de `pricing/application` e `pricing/hooks`, sem UI e sem `number` em dinheiro.

**Formatação (`formatUsd.ts`)**, pt-BR, feita sobre `toFixed` (sem `Intl`, sem ponto flutuante):
- `formatUsd`: 2 casas, milhar com ponto, vírgula decimal: `US$ 1.234,56`. Positivo menor que um centavo vira `< US$ 0,01` (negativo, `> −US$ 0,01`); zero é `US$ 0,00`. Sinal negativo é U+2212 (`−`).
- `formatUnitPrice`: exato, de 2 a 12 casas, sem zeros extras além das 2 primeiras: `US$ 0,0000002`.
- `formatQuantity`: milhar com ponto e até 12 casas, sem zeros à direita.

**Linhas (`costRows.ts`)**:
- Ordem: itens com preço > 0 por custo decrescente, depois custo zero, depois `unavailable`. Empate pela ordem do design. A comparação usa `compare` de `money.ts`, nunca `number`.
- Nome da aresta: `origem → destino`; o nó `client` aparece como `Internet`.
- Barra de proporção: `number` só para a largura do desenho, nunca para valor exibido.

**`useCostView` (`hooks/useCostView.ts`)**: memoiza por identidade de design e de catálogo. Com `updating`, mantém o último resultado. Medido: recálculo de 100 blocos leva cerca de 1 a 3 ms, por isso não há `useDeferredValue` nem Worker.

## Testes

`createEstimator(blocks: BlockPricing)` monta o motor sobre um registro de blocos e existe para testá-lo com funções de preço de teste. `estimate` é o `createEstimator` ligado ao registro real (`blockRegistry.ts`). `createEstimator` não é exportado pelo `index.ts`.
