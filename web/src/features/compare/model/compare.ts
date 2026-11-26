import { EDGE_KINDS, type DesignDocument } from '../../../shared/lib/design';
import {
  compare,
  decimal,
  sub,
  sum,
  toFixed,
  type Decimal,
  type Money,
} from '../../../shared/lib/money';
import type { CostEstimate } from '../../pricing';

const ZERO = decimal(0);

/**
 * Um valor dos dois lados e a diferença `b − a` (positiva: B custa mais). `a` e `b` são exatos;
 * `diff` é a diferença dos valores como aparecem, em centavos (meio-para-par, como `formatUsd`),
 * para que a conta feita na tela feche.
 */
export interface Amounts {
  readonly a: Money;
  readonly b: Money;
  readonly diff: Money;
}

/** Um tipo de bloco (`aws.ec2`) ou de aresta (`data`) nos dois lados. */
export interface CompareRow {
  readonly key: string;
  readonly countA: number;
  readonly countB: number;
  readonly total: Amounts;
}

export interface Comparison {
  readonly total: Amounts;
  readonly fixed: Amounts;
  readonly variable: Amounts;
  /** Tipos dos dois lados unidos; maior diferença (em módulo) primeiro, empate pela chave. */
  readonly blocks: readonly CompareRow[];
  /** Só os tipos de aresta que algum lado usa, na ordem do contrato. */
  readonly edges: readonly CompareRow[];
  /** Itens sem preço no catálogo (valem zero, fora dos totais), por lado. */
  readonly unavailable: { readonly a: number; readonly b: number };
}

export type Direction = 'more' | 'less' | 'same';

/** `more`: B custa mais que A. */
export function directionOf(diff: Decimal): Direction {
  const order = compare(diff, ZERO);
  return order > 0 ? 'more' : order < 0 ? 'less' : 'same';
}

const cents = (value: Money): Money => decimal(toFixed(value, 2));
const amounts = (a: Money, b: Money): Amounts => ({ a, b, diff: sub(cents(b), cents(a)) });
const absolute = (value: Decimal): Decimal => (compare(value, ZERO) < 0 ? sub(ZERO, value) : value);

type Item = { readonly status: string; readonly total: Money };
type Groups = Map<string, Item[]>;

function groupBy<T extends Item>(items: readonly T[], keyOf: (item: T) => string): Groups {
  const groups: Groups = new Map();
  for (const item of items) groups.set(keyOf(item), [...(groups.get(keyOf(item)) ?? []), item]);
  return groups;
}

function rowsOf(left: Groups, right: Groups, keys: readonly string[]): CompareRow[] {
  const totalOf = (items: Item[] = []) => sum(items.map((item) => item.total));
  return keys.map((key) => ({
    key,
    countA: left.get(key)?.length ?? 0,
    countB: right.get(key)?.length ?? 0,
    total: amounts(totalOf(left.get(key)), totalOf(right.get(key))),
  }));
}

/** Compara duas estimativas (cada uma com o catálogo da região do próprio design). Pura: só `Decimal`. */
export function compareEstimates(a: CostEstimate, b: CostEstimate): Comparison {
  const [blocksA, blocksB] = [
    groupBy(a.blocks, (x) => x.blockType),
    groupBy(b.blocks, (x) => x.blockType),
  ];
  const [edgesA, edgesB] = [groupBy(a.edges, (x) => x.kind), groupBy(b.edges, (x) => x.kind)];
  const blockKeys = [...new Set([...blocksA.keys(), ...blocksB.keys()])];
  const blocks = rowsOf(blocksA, blocksB, blockKeys).sort(
    (x, y) => compare(absolute(y.total.diff), absolute(x.total.diff)) || (x.key < y.key ? -1 : 1),
  );
  const edgeKeys = EDGE_KINDS.filter((kind) => edgesA.has(kind) || edgesB.has(kind));
  const missing = (e: CostEstimate) =>
    [...e.blocks, ...e.edges].filter((item) => item.status === 'unavailable').length;
  return {
    total: amounts(a.total, b.total),
    fixed: amounts(a.fixed, b.fixed),
    variable: amounts(a.variable, b.variable),
    blocks,
    edges: rowsOf(edgesA, edgesB, edgeKeys),
    unavailable: { a: missing(a), b: missing(b) },
  };
}

/** Espaços repetidos, quebras de linha e as pontas não contam ao comparar descrições. */
export const normalizeWorkload = (description: string): string =>
  description.trim().replace(/\s+/g, ' ');

type Context = Pick<DesignDocument, 'region' | 'workload'>;

/** O que muda entre os designs além do custo: região e descrição de carga (só texto, nunca HTML). */
export const contextDifferences = (a: Context, b: Context) => ({
  region: a.region !== b.region,
  workload: normalizeWorkload(a.workload.description) !== normalizeWorkload(b.workload.description),
});
