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
const usd = (values: Decimal[]) => values.map((value) => toFixed(value, 12));
const ZEROS = Array<string>(3).fill('0.000000000000');

function expectZeroItem(item: BlockCost | EdgeCost) {
  expect(item.status).toBe('priced');
  expect(usd([item.total, item.fixed, item.variable])).toEqual(ZEROS);
  expect(item.lines).toEqual([]);
}

describe('estimate (implementação provisória)', () => {
  const result = estimate(adrDesign, catalog);

  it('devolve total, fixo e variável zerados', () => {
    expect(usd([result.total, result.fixed, result.variable])).toEqual(ZEROS);
  });

  it('devolve um item zerado por bloco do exemplo do ADR, na ordem do design, com blockType', () => {
    expect(result.blocks.map((b) => [b.blockId, b.blockType])).toEqual([
      ['blk_fn_api', 'aws.lambda'],
      ['blk_assets', 'aws.s3'],
    ]);
    result.blocks.forEach(expectZeroItem);
  });

  it('devolve um item zerado por aresta do exemplo do ADR, com kind', () => {
    expect(result.edges.map((e) => [e.edgeId, e.kind])).toEqual([['edg_1', 'data']]);
    result.edges.forEach(expectZeroItem);
  });

  it('preserva a ordem do design com vários blocos e arestas', () => {
    const kinds = ['logs', 'data', 'runs-on'] as const;
    const design = designDocumentSchema.parse({
      ...adrExampleDesign,
      blocks: designWithBlocks(4).blocks.reverse(),
      edges: kinds.map((kind, i) => ({
        ...adrExampleDesign.edges[0],
        ...{ id: `edg_${i}`, source: `blk_${i}`, target: `blk_${i + 1}`, kind },
      })),
    });
    const { blocks, edges } = estimate(design, catalog);
    expect(blocks.map((b) => b.blockId)).toEqual(['blk_3', 'blk_2', 'blk_1', 'blk_0']);
    expect(edges.map((e) => [e.edgeId, e.kind])).toEqual(
      kinds.map((kind, i) => [`edg_${i}`, kind]),
    );
  });

  it('é pura: não altera o design nem o catálogo e repete o resultado', () => {
    const [design, sameCatalog] = [structuredClone(adrDesign), structuredClone(catalog)];
    const first = estimate(design, sameCatalog);
    expect(design).toEqual(adrDesign);
    expect(sameCatalog).toEqual(catalog);
    expect(estimate(design, sameCatalog)).toEqual(first);
  });
});
