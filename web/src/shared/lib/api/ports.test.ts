// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { adrExampleDesign } from '../../../test/designFixtures';
import {
  designIdSchema,
  designSchema,
  designSummarySchema,
  estimateRequestSchema,
  estimateResponseSchema,
  quotaSchema,
} from './index';

const ULID = '01JDQX3Z8V6Q2K9M4N7P5R1S0T';
const summary = {
  id: ULID,
  name: 'Meu design',
  region: 'us-east-1',
  schemaVersion: 1,
  blockCount: 2,
  sizeBytes: 900,
  createdAt: '2026-11-25T10:00:00Z',
  updatedAt: '2026-11-25T10:00:00Z',
  version: 1,
};
const quota = { limit: 10, remaining: 9, resetsAt: '2026-12-01T00:00:00Z' };

describe('designIdSchema', () => {
  it.each([ULID, '1'.padStart(26, '0')])('aceita %s', (id) => {
    expect(designIdSchema.safeParse(id).success).toBe(true);
  });
  it.each([ULID.slice(1), 'I', 'L', 'O', 'U', 'a'].map((x) => [x]))('recusa %s', (x) => {
    const id = x.length === 25 ? x : `${ULID.slice(0, 25)}${x}`;
    expect(designIdSchema.safeParse(id).success).toBe(false);
  });
});

describe('designSummarySchema', () => {
  it('aceita um item válido e descarta chaves desconhecidas, inclusive doc', () => {
    const parsed = designSummarySchema.parse({ ...summary, doc: adrExampleDesign, extra: 1 });
    expect(parsed).toEqual(summary);
    expect(parsed).not.toHaveProperty('doc');
  });
  it.each([
    ['updatedAt fora de UTC', { updatedAt: '2026-11-25T10:00:00-03:00' }],
    ['version 0', { version: 0 }],
  ])('recusa %s', (_n, patch) => {
    expect(designSummarySchema.safeParse({ ...summary, ...patch }).success).toBe(false);
  });
});

describe('designSchema', () => {
  it('aceita o item com doc', () => {
    expect(designSchema.safeParse({ ...summary, doc: adrExampleDesign }).success).toBe(true);
  });
});

describe('estimateRequestSchema', () => {
  it('descarta label, usage e overrides e mantém o resto', () => {
    const { region, workload, blocks, edges } = adrExampleDesign;
    const parsed = estimateRequestSchema.parse({
      region,
      description: workload.description,
      blocks,
      edges,
    });
    expect(parsed.blocks.map((b) => Object.keys(b).sort())).toEqual([
      ['attributes', 'id', 'type'],
      ['attributes', 'id', 'type'],
    ]);
    expect(parsed.edges.map((e) => Object.keys(e).sort())).toEqual([
      ['id', 'kind', 'source', 'target'],
    ]);
    expect(parsed.blocks.map((b) => b.id)).toEqual(['blk_fn_api', 'blk_assets']);
  });
});

describe('estimateResponseSchema', () => {
  const ok = { blocks: [{ id: 'blk_fn_api', values: { requestsPerMonth: 5 } }], edges: [], quota };
  it('aceita só números com a quota', () => {
    expect(estimateResponseSchema.safeParse(ok).success).toBe(true);
  });
  it('recusa valor não numérico', () => {
    const bad = { ...ok, blocks: [{ id: 'blk_fn_api', values: { requestsPerMonth: 'muito' } }] };
    expect(estimateResponseSchema.safeParse(bad).success).toBe(false);
  });
});

describe('quotaSchema', () => {
  it.each([
    ['resetsAt fora de UTC', { resetsAt: '2026-12-01T00:00:00+02:00' }],
    ['remaining negativo', { remaining: -1 }],
  ])('recusa %s', (_n, patch) => {
    expect(quotaSchema.safeParse({ ...quota, ...patch }).success).toBe(false);
  });
});
