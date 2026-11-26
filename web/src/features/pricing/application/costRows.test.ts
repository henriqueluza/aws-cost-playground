import { describe, expect, it } from 'vitest';
import type { Block, DesignDocument } from '../../../shared/lib/design';
import { decimal } from '../../../shared/lib/money';
import { adrExampleDesign } from '../../../test/designFixtures';
import type { CostEstimate } from '../model/engine';
import { buildCostRows, fixedShare, sortRows, type CostRow } from './costRows';

const z = decimal(0);
const item = (total: string, status: 'priced' | 'unavailable' = 'priced') => {
  const value = decimal(total);
  return { status, total: value, fixed: z, variable: value, lines: [] };
};

const estimateOf = (blocks: Record<string, ReturnType<typeof item>>): CostEstimate => ({
  total: z,
  fixed: z,
  variable: z,
  blocks: Object.entries(blocks).map(([blockId, cost]) => ({
    blockId,
    blockType: 'aws.lambda',
    ...cost,
  })),
  edges: [{ edgeId: 'edg_1', kind: 'data', ...item('0') }],
});

const lambda: Block = {
  id: 'x',
  type: 'aws.lambda',
  label: '',
  attributes: {},
  usage: { source: 'default', values: {} },
  overrides: {},
};

const design: DesignDocument = {
  ...adrExampleDesign,
  blocks: [
    { ...lambda, id: 'a', label: 'Zero' },
    { ...lambda, id: 'b', label: 'Barato' },
    { ...lambda, id: 'c', label: 'Sem preço' },
    { ...lambda, id: 'd', label: '  ' },
    { ...lambda, id: 'e', label: 'Caro' },
  ],
  edges: [
    {
      id: 'edg_1',
      source: 'e',
      target: 'client',
      kind: 'data',
      usage: { source: 'default', values: {} },
      overrides: {},
    },
  ],
};

describe('buildCostRows', () => {
  const rows = buildCostRows(
    design,
    estimateOf({
      a: item('0'),
      b: item('0.0004'),
      c: item('0', 'unavailable'),
      d: item('0.0004'),
      e: item('12345.67'),
    }),
  );

  it('ordena do mais caro ao mais barato, custo zero depois e sem preço por último', () => {
    expect(rows.blocks.map((r) => r.id)).toEqual(['e', 'b', 'd', 'a', 'c']);
  });

  it('desempata pela ordem do design e nomeia bloco sem rótulo pelo tipo', () => {
    expect(rows.blocks.map((r) => r.name)).toEqual([
      'Caro',
      'Barato',
      'aws.lambda',
      'Zero',
      'Sem preço',
    ]);
  });

  it('conta os itens sem preço', () => {
    expect(rows.unavailable).toBe(1);
  });

  it('dá à aresta o nome origem → destino, com Internet para o nó fixo', () => {
    expect(rows.edges[0]).toMatchObject({ name: 'Caro → Internet', meta: 'data', category: null });
  });

  it('calcula a barra pelo maior custo, sem passar por number para comparar', () => {
    expect(rows.blocks[0]?.share).toBe(1);
    expect(rows.blocks[1]?.share).toBe(0);
    expect(rows.blocks[3]?.share).toBe(0);
  });

  it('compara valores além da precisão do ponto flutuante', () => {
    const big = (n: string) => ({ ...item(n) });
    const sorted = sortRows(
      buildCostRows(
        design,
        estimateOf({ a: big('9007199254740993.000001'), b: big('9007199254740993.000002') }),
      ).blocks,
    );
    expect(sorted.map((r) => r.id).slice(0, 2)).toEqual(['b', 'a']);
  });
});

describe('sortRows', () => {
  it('não altera a lista recebida', () => {
    const list: CostRow[] = buildCostRows(
      design,
      estimateOf({ a: item('1'), b: item('2') }),
    ).blocks.slice();
    const copy = [...list];
    sortRows(list);
    expect(list).toEqual(copy);
  });
});

describe('fixedShare', () => {
  it('é a parte fixa do total, e zero sem total', () => {
    expect(fixedShare(decimal('61.2'), decimal('23.1'))).toBeCloseTo(0.726, 3);
    expect(fixedShare(z, z)).toBe(0);
  });
});
