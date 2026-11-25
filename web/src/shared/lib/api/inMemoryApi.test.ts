// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { adrExampleDesign, designWithBlocks } from '../../../test/designFixtures';
import { designDocumentSchema } from '../design';
import {
  ApiError,
  type ApiErrorKind,
  type CreateDesignInput,
  designIdSchema,
  designSchema,
  designSummarySchema,
} from './index';
import { createInMemoryApi, type InMemoryApiOptions } from './inMemoryApi';

const T0 = Date.parse('2026-11-25T10:00:00.000Z');
const BIG = 10_000_000;
const ADR_DOC = designDocumentSchema.parse(adrExampleDesign);
const SMALL_DOC = designDocumentSchema.parse(designWithBlocks(1));
const LARGE_DOC = designDocumentSchema.parse(designWithBlocks(5));
const UNKNOWN = '0'.repeat(26);

function setup(overrides: Partial<InMemoryApiOptions> = {}) {
  let t = T0;
  const api = createInMemoryApi({
    maxDesigns: 50,
    maxDocBytes: BIG,
    now: () => new Date(t),
    ...overrides,
  });
  return { ...api, advance: (ms = 1000) => (t += ms), iso: () => new Date(t).toISOString() };
}

const rejectsWith = (p: Promise<unknown>, kind: ApiErrorKind) =>
  expect(p).rejects.toMatchObject({ detail: { kind } });
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
const sizeOf = async (doc: CreateDesignInput['doc']) =>
  (await setup().designs.create({ name: 'x', doc })).sizeBytes;
const bad = (value: unknown) => value as unknown as CreateDesignInput;

describe('createInMemoryApi: create', () => {
  it('devolve o design gravado, válido em designSchema', async () => {
    const { designs, iso } = setup();
    const d = await designs.create({ name: '  Meu design  ', doc: ADR_DOC });
    expect(designSchema.safeParse(d).success).toBe(true);
    expect(d).toMatchObject({
      name: 'Meu design',
      version: 1,
      createdAt: iso(),
      updatedAt: iso(),
      blockCount: 2,
      region: 'us-east-1',
      schemaVersion: 1,
    });
    expect(await designs.get(d.id)).toEqual(d);
  });

  it('grava o doc sem chaves extras e calcula sizeBytes em bytes UTF-8', async () => {
    const { designs } = setup();
    const block = { ...adrExampleDesign.blocks[0], label: 'Função ação', extra: 1 };
    const doc = {
      ...adrExampleDesign,
      workload: { description: 'Descrição única', extra: 2 },
      blocks: [block],
      edges: [],
      extra: 3,
    };
    const d = await designs.create(bad({ name: 'Acentos', doc }));
    expect(d.doc).not.toHaveProperty('extra');
    expect(d.doc.blocks[0]).not.toHaveProperty('extra');
    expect(d.doc.workload).not.toHaveProperty('extra');
    expect(d.sizeBytes).toBe(bytes(d.doc));
    expect(d.sizeBytes).toBeGreaterThan(JSON.stringify(d.doc).length);
  });

  it('gera ids padrão distintos e válidos', async () => {
    const { designs } = setup();
    const a = await designs.create({ name: 'A', doc: SMALL_DOC });
    const b = await designs.create({ name: 'B', doc: SMALL_DOC });
    expect([a.id, b.id]).toEqual(['1'.padStart(26, '0'), '2'.padStart(26, '0')]);
    expect(designIdSchema.safeParse(b.id).success).toBe(true);
  });

  it.each([
    ['nome vazio', { name: '', doc: SMALL_DOC }],
    ['nome só com espaços', { name: '   ', doc: SMALL_DOC }],
    ['nome com 81 caracteres', { name: 'a'.repeat(81), doc: SMALL_DOC }],
    ['doc inválido', { name: 'ok', doc: { schemaVersion: 1 } }],
    ['input null', null],
  ])('rejeita invalid-request: %s', async (_caso, input) => {
    await rejectsWith(setup().designs.create(bad(input)), 'invalid-request');
  });

  it('rejeita com ApiError, sem lançar de forma síncrona', async () => {
    const p = setup().designs.create(bad(null));
    expect(p).toBeInstanceOf(Promise);
    await expect(p).rejects.toBeInstanceOf(ApiError);
  });
});

describe('createInMemoryApi: limites e precedência', () => {
  it('aceita doc com tamanho exato de maxDocBytes e rejeita 1 byte acima do limite', async () => {
    const size = await sizeOf(LARGE_DOC);
    const atLimit = setup({ maxDocBytes: size });
    await expect(atLimit.designs.create({ name: 'x', doc: LARGE_DOC })).resolves.toBeDefined();
    const below = setup({ maxDocBytes: size - 1 });
    await rejectsWith(below.designs.create({ name: 'x', doc: LARGE_DOC }), 'too-large');
    expect(await below.designs.list()).toEqual([]);
  });

  it('invalid-request vence too-large, e too-large vence design-limit', async () => {
    const s = setup({ maxDocBytes: await sizeOf(SMALL_DOC), maxDesigns: 1 });
    await rejectsWith(s.designs.create({ name: ' ', doc: LARGE_DOC }), 'invalid-request');
    await s.designs.create({ name: 'a', doc: SMALL_DOC });
    await rejectsWith(s.designs.create({ name: 'b', doc: LARGE_DOC }), 'too-large');
    await rejectsWith(s.designs.create({ name: 'b', doc: SMALL_DOC }), 'design-limit');
  });

  it('design-limit não cria nada, e remover abre vaga', async () => {
    const { designs } = setup({ maxDesigns: 2 });
    const a = await designs.create({ name: 'a', doc: SMALL_DOC });
    await designs.create({ name: 'b', doc: SMALL_DOC });
    await rejectsWith(designs.create({ name: 'c', doc: SMALL_DOC }), 'design-limit');
    expect(await designs.list()).toHaveLength(2);
    await designs.remove(a.id);
    await expect(designs.create({ name: 'c', doc: SMALL_DOC })).resolves.toBeDefined();
  });
});

describe('createInMemoryApi: get e remove', () => {
  it('get de id desconhecido dá not-found', async () => {
    await rejectsWith(setup().designs.get(UNKNOWN), 'not-found');
  });

  it('remove é idempotente e depois o get dá not-found', async () => {
    const { designs } = setup();
    await expect(designs.remove(UNKNOWN)).resolves.toBeUndefined();
    const d = await designs.create({ name: 'a', doc: SMALL_DOC });
    await expect(designs.remove(d.id)).resolves.toBeUndefined();
    await expect(designs.remove(d.id)).resolves.toBeUndefined();
    await rejectsWith(designs.get(d.id), 'not-found');
    expect(await designs.list()).toEqual([]);
  });
});

describe('createInMemoryApi: list', () => {
  it('ordena por updatedAt decrescente, sem a chave doc', async () => {
    const s = setup();
    const a = await s.designs.create({ name: 'a', doc: SMALL_DOC });
    s.advance();
    const b = await s.designs.create({ name: 'b', doc: SMALL_DOC });
    const items = await s.designs.list();
    expect(items.map((i) => i.id)).toEqual([b.id, a.id]);
    for (const item of items) {
      expect(item).not.toHaveProperty('doc');
      expect(designSummarySchema.safeParse(item).success).toBe(true);
    }
  });

  it('desempata por id decrescente com o mesmo relógio', async () => {
    const ids = [2, 3, 1].map((n) => String(n).padStart(26, '0'));
    const s = setup({ newId: () => ids.shift() as string });
    for (const name of ['a', 'b', 'c']) await s.designs.create({ name, doc: SMALL_DOC });
    const order = (await s.designs.list()).map((i) => i.id);
    expect(order).toEqual([3, 2, 1].map((n) => String(n).padStart(26, '0')));
  });

  it('vazio no começo', async () => {
    expect(await setup().designs.list()).toEqual([]);
  });
});

describe('createInMemoryApi: cópias defensivas', () => {
  it('mutar input, retorno do create, do get ou item do list não altera o estado', async () => {
    const { designs } = setup();
    const input = { name: 'a', doc: structuredClone(SMALL_DOC) };
    const created = await designs.create(input);
    const original = structuredClone(created);
    input.name = 'mutado';
    input.doc.workload.description = 'mutado';
    created.name = 'mutado';
    created.doc.workload.description = 'mutado';
    expect(await designs.get(created.id)).toEqual(original);
    const got = await designs.get(created.id);
    got.doc.region = 'sa-east-1';
    got.version = 99;
    expect(await designs.get(created.id)).toEqual(original);
    for (const item of await designs.list()) item.name = 'mutado';
    expect(await designs.list()).toMatchObject([{ name: 'a' }]);
  });
});

describe('createInMemoryApi: estado', () => {
  it('deleteAccount apaga os designs, e o fake continua utilizável', async () => {
    const { designs, account } = setup({ maxDesigns: 1 });
    const d = await designs.create({ name: 'a', doc: SMALL_DOC });
    await expect(account.deleteAccount()).resolves.toBeUndefined();
    expect(await designs.list()).toEqual([]);
    await rejectsWith(designs.get(d.id), 'not-found');
    await expect(designs.create({ name: 'b', doc: SMALL_DOC })).resolves.toBeDefined();
  });

  it('cada instância tem o próprio estado', async () => {
    const one = setup();
    const other = setup();
    const d = await one.designs.create({ name: 'a', doc: SMALL_DOC });
    expect(await other.designs.list()).toEqual([]);
    await rejectsWith(other.designs.get(d.id), 'not-found');
  });
});
