import { describe, expect, it } from 'vitest';
import { designDocumentSchema } from '../../../shared/lib/design';
import { adrExampleDesign } from '../../../test/designFixtures';
import {
  applyEstimate,
  estimateFingerprint,
  freshness,
  toEstimateRequest,
  type UsageContract,
} from './estimateModel';

const doc = designDocumentSchema.parse(adrExampleDesign);
const contract: UsageContract = {
  block: (type) =>
    type === 'aws.lambda'
      ? [
          { key: 'requestsPerMonth', min: 0, max: 1e9, integer: true },
          { key: 'avgDurationMs', min: 1, max: 900_000, integer: false },
        ]
      : type === 'aws.s3'
        ? [{ key: 'storageGb', min: 0, max: 1e6, integer: false }]
        : undefined,
  edge: (kind) =>
    kind === 'data' ? [{ key: 'gbPerMonth', min: 0, max: 1e6, integer: false }] : undefined,
};
const NOW = '2026-11-26T12:00:00.000Z';
const apply = (blocks: unknown[], edges: unknown[] = []) =>
  applyEstimate(doc, { blocks, edges } as never, contract, NOW);
const block = (d: typeof doc, id: string) => d.blocks.find((b) => b.id === id);

describe('applyEstimate', () => {
  it('substitui usage inteiro (com origem e hora) e NUNCA toca em overrides', () => {
    const r = apply(
      [
        { id: 'blk_fn_api', source: 'llm', values: { requestsPerMonth: 10 } }, // com override
        { id: 'blk_assets', source: 'default', values: { storageGb: 7 } }, // sem override
      ],
      [{ id: 'edg_1', source: 'llm', values: { gbPerMonth: 5 } }],
    );
    expect(block(r.document, 'blk_fn_api')?.usage).toEqual({
      source: 'llm',
      estimatedAt: NOW,
      values: { requestsPerMonth: 10 }, // avgDurationMs antigo some: usage é substituído
    });
    expect(block(r.document, 'blk_fn_api')?.overrides).toEqual(doc.blocks[0]?.overrides);
    expect(block(r.document, 'blk_assets')?.usage.source).toBe('default');
    expect(r.document.edges[0]?.usage.values).toEqual({ gbPerMonth: 5 });
    expect(r.document.edges[0]?.overrides).toEqual({});
    expect(r).toMatchObject({ blocks: 2, edges: 1 });
    expect(designDocumentSchema.safeParse(r.document).success).toBe(true);
  });

  it.each([
    ['id que não existe no diagrama', { id: 'blk_fantasma', values: { storageGb: 1 } }],
    ['chave fora do contrato do tipo', { id: 'blk_assets', values: { requestsPerMonth: 1 } }],
    ['número acima da faixa', { id: 'blk_assets', values: { storageGb: 1e7 } }],
    ['número abaixo da faixa', { id: 'blk_fn_api', values: { avgDurationMs: 0 } }],
    ['fracionário em chave inteira', { id: 'blk_fn_api', values: { requestsPerMonth: 1.5 } }],
    ['chave do protótipo', { id: 'blk_assets', values: { constructor: 1 } }],
    ['sem valores', { id: 'blk_assets', values: {} }],
  ])('recusa: %s (o documento fica igual)', (_name, item) => {
    const r = apply([{ source: 'llm', ...item }]);
    expect(r.document).toEqual(doc);
    expect(r).toMatchObject({ blocks: 0, edges: 0 });
  });

  it('aceita as chaves boas de um item e descarta as ruins; vale a primeira repetição', () => {
    const r = apply([
      { id: 'blk_fn_api', source: 'llm', values: { requestsPerMonth: 4, avgDurationMs: -1 } },
      { id: 'blk_fn_api', source: 'llm', values: { requestsPerMonth: 99 } },
    ]);
    expect(block(r.document, 'blk_fn_api')?.usage.values).toEqual({ requestsPerMonth: 4 });
  });

  it('aresta com tipo sem uso no contrato e bloco de tipo desconhecido não recebem nada', () => {
    const odd = designDocumentSchema.parse({
      ...adrExampleDesign,
      blocks: [
        { ...adrExampleDesign.blocks[0], type: 'aws.desconhecido' },
        adrExampleDesign.blocks[1],
      ],
      edges: [],
    });
    const r = applyEstimate(
      odd,
      { blocks: [{ id: 'blk_fn_api', source: 'llm', values: { a: 1 } }], edges: [] } as never,
      contract,
      NOW,
    );
    expect(r.document).toEqual(odd);
  });
});

describe('impressão digital e desatualizada', () => {
  const edit = (fn: (d: typeof doc) => typeof doc) => fn(structuredClone(doc));
  it('sem estimativa: never; igual: fresh', () => {
    expect(freshness(null, doc)).toBe('never');
    expect(freshness(estimateFingerprint(doc), doc)).toBe('fresh');
  });

  it.each([
    ['descrição', (d: typeof doc) => ({ ...d, workload: { description: 'outra' } })],
    [
      'bloco novo',
      (d: typeof doc) => ({ ...d, blocks: [...d.blocks, { ...d.blocks[1]!, id: 'blk_novo' }] }),
    ],
    ['bloco removido', (d: typeof doc) => ({ ...d, blocks: d.blocks.slice(0, 1), edges: [] })],
    [
      'atributo',
      (d: typeof doc) => ({
        ...d,
        blocks: d.blocks.map((b) => ({ ...b, attributes: { ...b.attributes, memoryMb: 1024 } })),
      }),
    ],
    ['aresta removida', (d: typeof doc) => ({ ...d, edges: [] })],
    [
      'tipo da aresta',
      (d: typeof doc) => ({ ...d, edges: d.edges.map((e) => ({ ...e, kind: 'logs' as const })) }),
    ],
  ])('muda em: %s', (_n, change) => {
    expect(freshness(estimateFingerprint(doc), edit(change))).toBe('stale');
  });

  it.each([
    ['rótulo', (d: typeof doc) => ({ ...d, blocks: d.blocks.map((b) => ({ ...b, label: 'x' })) })],
    [
      'override',
      (d: typeof doc) => ({ ...d, blocks: d.blocks.map((b) => ({ ...b, overrides: { a: 1 } })) }),
    ],
    ['região', (d: typeof doc) => ({ ...d, region: 'sa-east-1' as const })],
    [
      'a própria estimativa aplicada',
      (d: typeof doc) =>
        apply([{ id: 'blk_assets', source: 'llm', values: { storageGb: 3 } }]).document ?? d,
    ],
  ])('não muda em: %s', (_n, change) => {
    expect(freshness(estimateFingerprint(doc), edit(change))).toBe('fresh');
  });

  it('a ordem das chaves de atributo não conta', () => {
    const a = edit((d) => ({
      ...d,
      blocks: d.blocks.map((b) => ({ ...b, attributes: { z: 1, a: 2 } })),
    }));
    const b = edit((d) => ({
      ...d,
      blocks: d.blocks.map((x) => ({ ...x, attributes: { a: 2, z: 1 } })),
    }));
    expect(estimateFingerprint(a)).toBe(estimateFingerprint(b));
  });

  it('o pedido leva só id, tipo, atributos e pontas', () => {
    const req = toEstimateRequest(doc);
    expect(Object.keys(req.blocks[0] ?? {}).sort()).toEqual(['attributes', 'id', 'type']);
    expect(Object.keys(req.edges[0] ?? {}).sort()).toEqual(['id', 'kind', 'source', 'target']);
  });
});
