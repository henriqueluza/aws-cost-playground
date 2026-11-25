// @vitest-environment node
import { describe, expect, expectTypeOf, it } from 'vitest';
import { adrExampleDesign } from '../../../test/designFixtures';
import {
  type AccountApi,
  type Api,
  type Design,
  type DesignsApi,
  type EstimateRequest,
  type EstimatesApi,
  type QuotaApi,
  type UpdateDesignInput,
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
  it.each([
    ['25 caracteres', ULID.slice(1)],
    ['27 caracteres', `${ULID}0`],
    ['a letra I', `${ULID.slice(0, 25)}I`],
    ['a letra L', `${ULID.slice(0, 25)}L`],
    ['a letra O', `${ULID.slice(0, 25)}O`],
    ['a letra U', `${ULID.slice(0, 25)}U`],
    ['minúsculas', ULID.toLowerCase()],
  ])('recusa %s', (_n, id) => {
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
  it('recusa doc inválido (bloco repetido)', () => {
    const [block] = adrExampleDesign.blocks;
    const doc = { ...adrExampleDesign, blocks: [block, block], edges: [] };
    expect(designSchema.safeParse({ ...summary, doc }).success).toBe(false);
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
  it.each([
    ['blocks', 'blk_fn_api'],
    ['edges', 'edg_1'],
  ])('recusa valor não numérico em %s', (key, id) => {
    const bad = { ...ok, [key]: [{ id, values: { gbPerMonth: 'muito' } }] };
    expect(estimateResponseSchema.safeParse(bad).success).toBe(false);
  });
});

describe('quotaSchema', () => {
  it('aceita a quota do servidor', () => {
    expect(quotaSchema.parse(quota)).toEqual(quota);
  });
  it.each([
    ['resetsAt fora de UTC', { resetsAt: '2026-12-01T00:00:00+02:00' }],
    ['remaining negativo', { remaining: -1 }],
  ])('recusa %s', (_n, patch) => {
    expect(quotaSchema.safeParse({ ...quota, ...patch }).success).toBe(false);
  });
});

describe('portas', () => {
  it('não recebem userId: a identidade vem só do JWT', () => {
    expectTypeOf<keyof Api>().toEqualTypeOf<'designs' | 'estimates' | 'quota' | 'account'>();
    expectTypeOf<Parameters<DesignsApi['get']>>().toEqualTypeOf<[id: string]>();
    expectTypeOf<Parameters<DesignsApi['update']>>().toEqualTypeOf<
      [id: string, input: UpdateDesignInput]
    >();
    expectTypeOf<Parameters<EstimatesApi['estimateUsage']>>().toEqualTypeOf<
      [request: EstimateRequest]
    >();
    expectTypeOf<Parameters<QuotaApi['get']>>().toEqualTypeOf<[]>();
    expectTypeOf<Parameters<AccountApi['deleteAccount']>>().toEqualTypeOf<[]>();
  });
  it('update exige name ou doc', () => {
    expectTypeOf<{ expectedVersion: number }>().not.toExtend<UpdateDesignInput>();
    expectTypeOf<{ expectedVersion: number; name: string }>().toExtend<UpdateDesignInput>();
    expectTypeOf<{ expectedVersion: number; doc: Design['doc'] }>().toExtend<UpdateDesignInput>();
    expectTypeOf<{
      expectedVersion: number;
      name: string;
      doc: Design['doc'];
    }>().toExtend<UpdateDesignInput>();
  });
});
