import type { Block, DesignDocument, EdgeKind } from '../../../shared/lib/design';
import { add, decimal, sum, type Decimal, type Money } from '../../../shared/lib/money';
import type { BlockDefinition, BlockPricer } from './blockContract';
import { blockPriceInput } from './blockInput';
import { blockDefinition, blockPricer } from './blockRegistry';
import type { PriceCatalog } from './catalog';
import { createRater } from './rating';

/** `unavailable`: falta preço para o item; os valores dele são zero, sem linhas, e ficam fora dos totais. */
export type CostStatus = 'priced' | 'unavailable';
/** `fixed`: cobrado por existir (hora, mês); `variable`: cobrado pelo uso informado no design. */
export type ChargeKind = 'fixed' | 'variable';

/** Uma cobrança de um SKU. Preço em faixas gera uma linha por faixa usada. */
export interface CostLine {
  /** SKU do catálogo (`Price.sku`). */
  readonly sku: string;
  /** Quantidade cobrada no mês nesta faixa, na unidade do SKU, já sem a franquia gratuita. */
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

/** De onde o motor tira o contrato e a função de preço de um tipo de bloco. */
export interface BlockPricing {
  definition(type: string): BlockDefinition | undefined;
  pricer(type: string): BlockPricer | undefined;
}

const ZERO = decimal(0);
const zeroCost = { status: 'priced', total: ZERO, fixed: ZERO, variable: ZERO, lines: [] } as const;
const unavailable = { ...zeroCost, status: 'unavailable' } as const;
const BLOCK_TYPE_PREFIX = 'aws.';

function itemCost(lines: readonly CostLine[] | undefined): ItemCost {
  if (lines === undefined) return unavailable;
  const amountOf = (charge: ChargeKind) =>
    sum(lines.filter((line) => line.charge === charge).map((line) => line.amount));
  const [fixed, variable] = [amountOf('fixed'), amountOf('variable')];
  return { status: 'priced', total: add(fixed, variable), fixed, variable, lines };
}

/**
 * Monta o `estimate` sobre um registro de blocos. Para cada bloco, na ordem do design: ajusta a
 * entrada ao contrato (`blockPriceInput`), chama a função de preço e aplica as regras do
 * catálogo (`createRater`). Sai `unavailable` o bloco de tipo sem contrato, com atributo fora
 * das opções ou com cobrança sem preço no catálogo, e todo bloco se o catálogo é de outra região.
 * As arestas saem `priced` com zero até a #42.
 */
export function createEstimator(blocks: BlockPricing) {
  return (design: DesignDocument, catalog: PriceCatalog): CostEstimate => {
    const sameRegion = design.region === catalog.region;
    const rater = createRater(catalog);

    const linesOf = (block: Block): readonly CostLine[] | undefined => {
      const definition = blocks.definition(block.type);
      const input = definition && blockPriceInput(definition, block);
      const pricer = blocks.pricer(block.type);
      if (!sameRegion || input === undefined || pricer === undefined) return undefined;
      const service = block.type.slice(BLOCK_TYPE_PREFIX.length);
      return rater.rate(
        pricer(input).map((charge) => ({ ...charge, service: charge.service ?? service })),
      );
    };

    const blockCosts = design.blocks.map((block) => ({
      ...itemCost(linesOf(block)),
      blockId: block.id,
      blockType: block.type,
    }));
    const edges = design.edges.map((e) => ({ ...zeroCost, edgeId: e.id, kind: e.kind }));
    const fixed = sum(blockCosts.map((block) => block.fixed));
    const variable = sum(blockCosts.map((block) => block.variable));
    return { total: add(fixed, variable), fixed, variable, blocks: blockCosts, edges };
  };
}

/**
 * Estima o custo mensal de um design já validado com o catálogo da região dele. Função pura e
 * determinística: não altera as entradas nem faz I/O.
 */
export const estimate = createEstimator({ definition: blockDefinition, pricer: blockPricer });
