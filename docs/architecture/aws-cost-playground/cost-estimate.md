# Contrato do resultado do motor de preço

`estimate(design, catalog)` recebe um design já validado e o catálogo da região dele e devolve o custo mensal em USD. O painel de custo (#43) consome este resultado.

- **Origem:** [ADR-0001](ADR-0001-stack.md). Formato do design em [design-document.md](design-document.md); do catálogo em [price-catalog.md](price-catalog.md).
- **Onde mora:** `web/src/features/pricing/model/engine.ts` (função `estimate` e os tipos `CostEstimate`, `BlockCost`, `EdgeCost`, `CostLine`, `CostStatus` e `ChargeKind`). Importe pelo `index.ts` da feature. Se este texto e o código divergirem, vale o código.
- **Função pura:** não altera as entradas nem faz I/O.

## Campos

| Tipo           | Campo                        | Significado                                                              |
| -------------- | ---------------------------- | ------------------------------------------------------------------------ |
| `CostEstimate` | `total`, `fixed`, `variable` | Custo mensal do design                                                   |
| `CostEstimate` | `blocks`, `edges`            | Um item por bloco e por aresta                                           |
| `BlockCost`    | `blockId`, `blockType`       | `Block.id` e `Block.type` do design                                      |
| `EdgeCost`     | `edgeId`, `kind`             | `Edge.id` e tipo da aresta                                               |
| item           | `status`                     | `priced` ou `unavailable` (`CostStatus`)                                 |
| item           | `total`, `fixed`, `variable` | Custo mensal do item                                                     |
| item           | `lines`                      | Cobranças (`CostLine`) que somam o item                                  |
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

## Provisório

A implementação atual devolve zero com status `priced` para todo bloco e aresta, sem `lines`, e ignora o catálogo. Serve para fixar a interface e destravar o painel. As regras de preço por serviço chegam nas Issues do motor (#26 em diante); o contrato acima não muda com elas.
