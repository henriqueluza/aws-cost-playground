import type { DesignDocument, EdgeKind } from '../../../shared/lib/design';
import { decimal, type Decimal, type Money } from '../../../shared/lib/money';
import type { PriceCatalog } from './catalog';

/** `unavailable`: falta preço no catálogo para o item; os valores dele são zero e ficam fora dos totais. */
export type CostStatus = 'priced' | 'unavailable';
/** `fixed`: cobrado por existir (hora, mês); `variable`: cobrado pelo uso informado no design. */
export type ChargeKind = 'fixed' | 'variable';

/** Uma cobrança de um SKU. Preço em faixas gera uma linha por faixa usada. */
export interface CostLine {
  /** SKU do catálogo (`Price.sku`). */
  readonly sku: string;
  /** Quantidade cobrada no mês, na unidade do SKU, já sem a franquia gratuita. */
  readonly quantity: Decimal;
  /** Preço em USD de uma unidade. */
  readonly unitPrice: Money;
  /** `quantity × unitPrice`, em USD por mês. */
  readonly amount: Money;
  readonly charge: ChargeKind;
}

/** Custo mensal de um item do design. `total = fixed + variable`, somados das `lines`. */
interface ItemCost {
  readonly status: CostStatus;
  readonly total: Money;
  readonly fixed: Money;
  readonly variable: Money;
  readonly lines: readonly CostLine[];
}

export interface BlockCost extends ItemCost {
  /** `Block.id` do design. */
  readonly blockId: string;
  /** `Block.type` do design (ex.: `aws.lambda`). */
  readonly blockType: string;
}

export interface EdgeCost extends ItemCost {
  /** `Edge.id` do design. */
  readonly edgeId: string;
  readonly kind: EdgeKind;
}

/** Custo mensal do design em USD. `Decimal` sai por `toFixed`: nunca vai a JSON, query key nem estado persistido. */
export interface CostEstimate {
  /** `fixed + variable`: soma dos blocos e das arestas com status `priced`. */
  readonly total: Money;
  readonly fixed: Money;
  readonly variable: Money;
  /** Um item por bloco, na ordem de `design.blocks`. */
  readonly blocks: readonly BlockCost[];
  /** Um item por aresta, na ordem de `design.edges`. */
  readonly edges: readonly EdgeCost[];
}

const ZERO = decimal(0);
const zeroCost = { status: 'priced', total: ZERO, fixed: ZERO, variable: ZERO, lines: [] } as const;

/**
 * Estima o custo mensal de um design já validado com o catálogo da região dele. Função pura:
 * não altera as entradas nem faz I/O. Implementação provisória: todo item sai `priced` com
 * zero; as regras de preço por bloco chegam nas Issues do motor.
 */
export function estimate(design: DesignDocument, catalog: PriceCatalog): CostEstimate {
  void catalog;
  const blocks = design.blocks.map((b) => ({ ...zeroCost, blockId: b.id, blockType: b.type }));
  const edges = design.edges.map((e) => ({ ...zeroCost, edgeId: e.id, kind: e.kind }));
  return { total: ZERO, fixed: ZERO, variable: ZERO, blocks, edges };
}
