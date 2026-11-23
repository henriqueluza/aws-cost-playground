import { describe, expect, it } from 'vitest';
import { designDocumentSchema, type DesignDocument } from '../../../shared/lib/design';
import { toFixed, type Decimal } from '../../../shared/lib/money';
import { adrExampleDesign, designWithBlocks } from '../../../test/designFixtures';
import { estimate, type BlockCost, type EdgeCost, type PriceCatalog } from '..';

const catalog: PriceCatalog = {
  region: 'us-east-1',
  manifest: { schemaVersion: 1, source: 'seed', generatedAt: '2026-11-23T12:00:00Z', files: [] },
  services: new Map(),
};
/** O exemplo do ADR como o motor o recebe: já validado pelo schema. */
const adrDesign: DesignDocument = designDocumentSchema.parse(adrExampleDesign);
const usd = (value: Decimal) => toFixed(value, 12);
const ZERO = '0.000000000000';

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function expectZeroItem(item: BlockCost | EdgeCost) {
  expect(item.status).toBe('priced');
  expect([item.total, item.fixed, item.variable].map(usd)).toEqual([ZERO, ZERO, ZERO]);
  expect(item.lines).toEqual([]);
}

describe('estimate (implementação provisória)', () => {
  const result = estimate(adrDesign, catalog);

  it('devolve total, fixo e variável zerados', () => {
    expect([result.total, result.fixed, result.variable].map(usd)).toEqual([ZERO, ZERO, ZERO]);
  });

  it('devolve um item por bloco do exemplo do ADR, na ordem do design, com blockType', () => {
    expect(result.blocks.map(({ blockId, blockType }) => ({ blockId, blockType }))).toEqual([
      { blockId: 'blk_fn_api', blockType: 'aws.lambda' },
      { blockId: 'blk_assets', blockType: 'aws.s3' },
    ]);
    result.blocks.forEach(expectZeroItem);
  });

  it('devolve um item por aresta do exemplo do ADR, na ordem do design, com kind', () => {
    expect(result.edges.map(({ edgeId, kind }) => ({ edgeId, kind }))).toEqual([
      { edgeId: 'edg_1', kind: 'data' },
    ]);
    result.edges.forEach(expectZeroItem);
  });

  it('preserva a ordem do design com vários blocos e arestas', () => {
    const base = designWithBlocks(5);
    const design: DesignDocument = designDocumentSchema.parse({
      ...base,
      blocks: [...base.blocks].reverse(),
      edges: (['logs', 'data', 'runs-on'] as const).map((kind, i) => ({
        ...adrExampleDesign.edges[0],
        id: `edg_${i}`,
        source: `blk_${i}`,
        target: `blk_${i + 1}`,
        kind,
      })),
    });
    const { blocks, edges } = estimate(design, catalog);
    expect(blocks.map((b) => b.blockId)).toEqual(['blk_4', 'blk_3', 'blk_2', 'blk_1', 'blk_0']);
    expect(edges.map((e) => [e.edgeId, e.kind])).toEqual([
      ['edg_0', 'logs'],
      ['edg_1', 'data'],
      ['edg_2', 'runs-on'],
    ]);
  });

  it('devolve listas vazias para um design sem blocos nem arestas', () => {
    const empty = estimate({ ...adrDesign, blocks: [], edges: [] }, catalog);
    expect(empty.blocks).toEqual([]);
    expect(empty.edges).toEqual([]);
    expect(usd(empty.total)).toBe(ZERO);
  });

  it('é pura: não altera o design nem o catálogo e repete o resultado', () => {
    const design = deepFreeze(structuredClone(adrDesign));
    const frozenCatalog = deepFreeze({ ...catalog, manifest: structuredClone(catalog.manifest) });
    const first = estimate(design, frozenCatalog);
    expect(design).toEqual(adrDesign);
    expect(frozenCatalog.manifest).toEqual(catalog.manifest);
    expect(frozenCatalog.services.size).toBe(0);
    expect(estimate(design, frozenCatalog)).toEqual(first);
  });
});
