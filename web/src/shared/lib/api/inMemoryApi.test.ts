// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { adrExampleDesign, designWithBlocks } from '../../../test/designFixtures';
import { designDocumentSchema } from '../design';
import {
  ApiError,
  type ApiErrorKind,
  type CreateDesignInput,
  type EstimateRequest,
  type UpdateDesignInput,
  designIdSchema,
  designSchema,
  designSummarySchema,
  estimateRequestSchema,
  estimateResponseSchema,
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
    userDailyLimit: 5,
    globalDailyLimit: 30,
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
    await rejectsWith(s.designs.create({ name: ' ', doc: SMALL_DOC }), 'invalid-request');
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

describe('createInMemoryApi: update', () => {
  it.each([
    ['expectedVersion 0', { expectedVersion: 0, name: 'x' }],
    ['expectedVersion 1.5', { expectedVersion: 1.5, name: 'x' }],
    ['sem expectedVersion', { name: 'x' }],
    ['sem name e sem doc', { expectedVersion: 1 }],
    ['nome só com espaços', { expectedVersion: 1, name: '   ' }],
    ['doc inválido', { expectedVersion: 1, doc: { schemaVersion: 1 } }],
    ['input null', null],
  ])('rejeita invalid-request sem gravar: %s', async (_caso, input) => {
    const { designs } = setup();
    const d = await designs.create({ name: 'a', doc: SMALL_DOC });
    await rejectsWith(designs.update(d.id, input as UpdateDesignInput), 'invalid-request');
    expect(await designs.get(d.id)).toEqual(d);
  });

  it('id desconhecido dá not-found', async () => {
    await rejectsWith(
      setup().designs.update(UNKNOWN, { expectedVersion: 1, name: 'x' }),
      'not-found',
    );
  });

  it('version-conflict não grava nada', async () => {
    const s = setup();
    const d = await s.designs.create({ name: 'a', doc: SMALL_DOC });
    s.advance();
    await rejectsWith(
      s.designs.update(d.id, { expectedVersion: 2, name: 'b', doc: LARGE_DOC }),
      'version-conflict',
    );
    expect(await s.designs.get(d.id)).toEqual(d);
    await s.designs.update(d.id, { expectedVersion: 1, name: 'b' });
    await rejectsWith(
      s.designs.update(d.id, { expectedVersion: 1, name: 'c' }),
      'version-conflict',
    );
    expect(await s.designs.get(d.id)).toMatchObject({ name: 'b', version: 2 });
  });

  it('soma 1 à version e muda só updatedAt; renomear preserva o doc', async () => {
    const s = setup();
    const d = await s.designs.create({ name: 'a', doc: LARGE_DOC });
    s.advance();
    const renamed = await s.designs.update(d.id, { expectedVersion: 1, name: ' b ' });
    expect(renamed).toEqual({ ...d, name: 'b', version: 2, updatedAt: s.iso() });
    s.advance();
    const redoc = await s.designs.update(d.id, { expectedVersion: 2, doc: SMALL_DOC });
    expect(redoc).toEqual({
      ...renamed,
      doc: SMALL_DOC,
      blockCount: 1,
      sizeBytes: bytes(SMALL_DOC),
      version: 3,
      updatedAt: s.iso(),
    });
    expect(designSchema.safeParse(redoc).success).toBe(true);
    expect(await s.designs.get(d.id)).toEqual(redoc);
  });

  it('aceita doc com tamanho exato de maxDocBytes e rejeita too-large acima, sem gravar', async () => {
    const size = await sizeOf(LARGE_DOC);
    const atLimit = setup({ maxDocBytes: size });
    const a = await atLimit.designs.create({ name: 'x', doc: SMALL_DOC });
    await expect(
      atLimit.designs.update(a.id, { expectedVersion: 1, doc: LARGE_DOC }),
    ).resolves.toMatchObject({ version: 2 });
    const below = setup({ maxDocBytes: size - 1 });
    const b = await below.designs.create({ name: 'x', doc: SMALL_DOC });
    await rejectsWith(
      below.designs.update(b.id, { expectedVersion: 1, name: 'y', doc: LARGE_DOC }),
      'too-large',
    );
    expect(await below.designs.get(b.id)).toEqual(b);
  });

  it('precedência: invalid-request, not-found, version-conflict, too-large', async () => {
    const { designs } = setup({ maxDocBytes: await sizeOf(SMALL_DOC) });
    const d = await designs.create({ name: 'a', doc: SMALL_DOC });
    await rejectsWith(
      designs.update(UNKNOWN, { expectedVersion: 0, doc: LARGE_DOC }),
      'invalid-request',
    );
    await rejectsWith(designs.update(UNKNOWN, { expectedVersion: 9, doc: LARGE_DOC }), 'not-found');
    await rejectsWith(
      designs.update(d.id, { expectedVersion: 9, doc: LARGE_DOC }),
      'version-conflict',
    );
    await rejectsWith(designs.update(d.id, { expectedVersion: 1, doc: LARGE_DOC }), 'too-large');
  });

  it('grava o doc do parse, sem chaves extras, e mede sizeBytes sobre ele', async () => {
    const { designs } = setup();
    const d = await designs.create({ name: 'a', doc: SMALL_DOC });
    const input = { expectedVersion: 1, doc: { ...LARGE_DOC, extra: 3 }, extra: 4 };
    const updated = await designs.update(d.id, input);
    expect(updated).not.toHaveProperty('extra');
    expect(updated.doc).toEqual(LARGE_DOC);
    expect(updated.sizeBytes).toBe(bytes(LARGE_DOC));
    expect(await designs.get(d.id)).toEqual(updated);
  });

  it('não guarda referência ao input nem ao retorno', async () => {
    const { designs } = setup();
    const d = await designs.create({ name: 'a', doc: SMALL_DOC });
    const input = { expectedVersion: 1, doc: structuredClone(LARGE_DOC) };
    const updated = await designs.update(d.id, input);
    const original = structuredClone(updated);
    input.doc.workload.description = 'mutado';
    updated.doc.region = 'sa-east-1';
    expect(await designs.get(d.id)).toEqual(original);
  });
});

describe('createInMemoryApi: duplicate', () => {
  it('cria id novo, version 1, datas novas, doc igual e nome do input', async () => {
    const s = setup();
    const d = await s.designs.create({ name: 'a', doc: LARGE_DOC });
    s.advance();
    const c = await s.designs.duplicate(d.id, { name: ' Cópia ' });
    expect(c.id).not.toBe(d.id);
    expect(designSchema.safeParse(c).success).toBe(true);
    expect(c).toEqual({ ...d, id: c.id, name: 'Cópia', createdAt: s.iso(), updatedAt: s.iso() });
    expect(await s.designs.get(c.id)).toEqual(c);
    expect(await s.designs.get(d.id)).toEqual(d);
    expect(await s.designs.list()).toHaveLength(2);
  });

  it('a cópia é profunda: mudar uma não altera a outra', async () => {
    const { designs } = setup();
    const d = await designs.create({ name: 'a', doc: LARGE_DOC });
    const c = await designs.duplicate(d.id, { name: 'b' });
    c.doc.workload.description = 'mutado';
    await designs.update(c.id, { expectedVersion: 1, doc: SMALL_DOC });
    expect(await designs.get(d.id)).toEqual(d);
    await designs.update(d.id, { expectedVersion: 1, name: 'a2' });
    await designs.remove(d.id);
    expect(await designs.get(c.id)).toMatchObject({ name: 'b', version: 2, doc: SMALL_DOC });
  });

  it.each([
    ['nome vazio', { name: '' }],
    ['nome com 81 caracteres', { name: 'a'.repeat(81) }],
    ['sem nome', {}],
    ['input null', null],
  ])('rejeita invalid-request sem criar nada: %s', async (_caso, input) => {
    const { designs } = setup();
    const d = await designs.create({ name: 'a', doc: SMALL_DOC });
    await rejectsWith(designs.duplicate(d.id, input as { name: string }), 'invalid-request');
    expect(await designs.list()).toHaveLength(1);
  });

  it('no limite rejeita com design-limit e não cria nada', async () => {
    const { designs } = setup({ maxDesigns: 2 });
    const d = await designs.create({ name: 'a', doc: SMALL_DOC });
    await expect(designs.duplicate(d.id, { name: 'b' })).resolves.toBeDefined();
    await rejectsWith(designs.duplicate(d.id, { name: 'c' }), 'design-limit');
    expect((await designs.list()).map((i) => i.name).sort()).toEqual(['a', 'b']);
  });

  it('precedência: invalid-request, not-found, design-limit', async () => {
    const { designs } = setup({ maxDesigns: 1 });
    const d = await designs.create({ name: 'a', doc: SMALL_DOC });
    await rejectsWith(designs.duplicate(UNKNOWN, { name: '  ' }), 'invalid-request');
    await rejectsWith(designs.duplicate(UNKNOWN, { name: 'b' }), 'not-found');
    await rejectsWith(designs.duplicate(d.id, { name: 'b' }), 'design-limit');
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

  it('um update leva o design para o topo: a ordem é por updatedAt, não por createdAt', async () => {
    const s = setup();
    const a = await s.designs.create({ name: 'a', doc: SMALL_DOC });
    s.advance();
    const b = await s.designs.create({ name: 'b', doc: SMALL_DOC });
    s.advance();
    await s.designs.update(a.id, { expectedVersion: 1, name: 'a2' });
    const items = await s.designs.list();
    expect(items.map((i) => i.id)).toEqual([a.id, b.id]);
    expect(items[0]).toMatchObject({ name: 'a2', version: 2, updatedAt: s.iso() });
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

const REQUEST = estimateRequestSchema.parse({
  region: ADR_DOC.region,
  description: ADR_DOC.workload.description,
  blocks: ADR_DOC.blocks,
  edges: ADR_DOC.edges,
});
const DAY_END = '2026-11-26T00:00:00.000Z';
const HOUR = 3_600_000;
const badRequest = (value: unknown) => value as unknown as EstimateRequest;
const rejectsExhausted = (p: Promise<unknown>, scope: 'user' | 'global', resetsAt = DAY_END) =>
  expect(p).rejects.toMatchObject({ detail: { kind: 'quota-exhausted', scope, resetsAt } });

describe('createInMemoryApi: quota', () => {
  it('get devolve o limite do usuário e a próxima meia-noite UTC, sem consumir', async () => {
    const { quota } = setup({ userDailyLimit: 3 });
    const expected = { limit: 3, remaining: 3, resetsAt: DAY_END };
    expect(await quota.get()).toEqual(expected);
    expect(await quota.get()).toEqual(expected);
  });

  it('resetsAt é a meia-noite UTC seguinte no último instante do dia e no primeiro', async () => {
    const s = setup();
    s.advance(14 * HOUR - 1);
    expect(s.iso()).toBe('2026-11-25T23:59:59.999Z');
    expect((await s.quota.get()).resetsAt).toBe(DAY_END);
    s.advance(1);
    expect((await s.quota.get()).resetsAt).toBe('2026-11-27T00:00:00.000Z');
  });

  it('remaining não reflete o contador global e não fica negativo', async () => {
    const s = setup({ userDailyLimit: 5, globalDailyLimit: 1 });
    await s.estimates.estimateUsage(REQUEST);
    expect(await s.quota.get()).toMatchObject({ limit: 5, remaining: 4 });
    expect(await setup({ userDailyLimit: 0 }).quota.get()).toMatchObject({ remaining: 0 });
  });
});

describe('createInMemoryApi: estimateUsage', () => {
  it('responde ids com values vazios por padrão e a quota já decrementada', async () => {
    const { estimates, quota } = setup({ userDailyLimit: 2 });
    const response = await estimates.estimateUsage(REQUEST);
    expect(estimateResponseSchema.safeParse(response).success).toBe(true);
    expect(response).toEqual({
      blocks: [
        { id: 'blk_fn_api', values: {}, source: 'default' },
        { id: 'blk_assets', values: {}, source: 'default' },
      ],
      edges: [{ id: 'edg_1', values: {}, source: 'default' }],
      quota: { limit: 2, remaining: 1, resetsAt: DAY_END },
    });
    expect(await quota.get()).toEqual(response.quota);
  });

  it('usa options.estimate com o pedido já validado e devolve só o que passa no schema', async () => {
    const seen: EstimateRequest[] = [];
    const { estimates } = setup({
      estimate: (request) => {
        seen.push(request);
        const block = {
          id: 'blk_fn_api',
          values: { requestsPerMonth: 10 },
          source: 'llm',
          note: 'texto livre',
        };
        return { blocks: [block], edges: [], quota: { remaining: 99 }, text: 'livre' } as never;
      },
    });
    const response = await estimates.estimateUsage(badRequest({ ...REQUEST, extra: 'x' }));
    expect(seen).toEqual([REQUEST]);
    expect(response).toEqual({
      blocks: [{ id: 'blk_fn_api', values: { requestsPerMonth: 10 }, source: 'llm' }],
      edges: [],
      quota: { limit: 5, remaining: 4, resetsAt: DAY_END },
    });
  });

  it('estimativa fora do schema dá invalid-response e não consome quota', async () => {
    const { estimates, quota } = setup({
      estimate: () => ({ blocks: [{ id: 'blk_fn_api', values: { texto: 'livre' } }] }) as never,
    });
    await rejectsWith(estimates.estimateUsage(REQUEST), 'invalid-response');
    expect((await quota.get()).remaining).toBe(5);
  });

  it('esgotar a quota do usuário dá quota-exhausted com scope user e resetsAt', async () => {
    const { estimates, quota } = setup({ userDailyLimit: 2 });
    await estimates.estimateUsage(REQUEST);
    expect((await estimates.estimateUsage(REQUEST)).quota.remaining).toBe(0);
    await rejectsExhausted(estimates.estimateUsage(REQUEST), 'user');
    await expect(estimates.estimateUsage(REQUEST)).rejects.toBeInstanceOf(ApiError);
    expect(await quota.get()).toEqual({ limit: 2, remaining: 0, resetsAt: DAY_END });
  });

  it('esgotar a quota global dá quota-exhausted com scope global, sem consumir a do usuário', async () => {
    const { estimates, quota } = setup({ userDailyLimit: 5, globalDailyLimit: 2 });
    await estimates.estimateUsage(REQUEST);
    await estimates.estimateUsage(REQUEST);
    await rejectsExhausted(estimates.estimateUsage(REQUEST), 'global');
    await rejectsExhausted(estimates.estimateUsage(REQUEST), 'global');
    expect((await quota.get()).remaining).toBe(3);
  });

  it('com os dois limites estourados vence o scope user', async () => {
    const { estimates } = setup({ userDailyLimit: 1, globalDailyLimit: 1 });
    await estimates.estimateUsage(REQUEST);
    await rejectsExhausted(estimates.estimateUsage(REQUEST), 'user');
  });

  it('a virada do dia UTC renova os dois contadores', async () => {
    const s = setup({ userDailyLimit: 1, globalDailyLimit: 1 });
    await s.estimates.estimateUsage(REQUEST);
    s.advance(14 * HOUR - 1);
    await rejectsExhausted(s.estimates.estimateUsage(REQUEST), 'user');
    s.advance(1);
    const next = '2026-11-27T00:00:00.000Z';
    expect(await s.quota.get()).toEqual({ limit: 1, remaining: 1, resetsAt: next });
    expect((await s.estimates.estimateUsage(REQUEST)).quota).toMatchObject({ remaining: 0 });
    await rejectsExhausted(s.estimates.estimateUsage(REQUEST), 'user', next);
  });

  it('llmEnabled=false responde unavailable sem consumir quota nem chamar estimate', async () => {
    let calls = 0;
    const estimate = () => (calls++, { blocks: [], edges: [] });
    const { estimates, quota } = setup({ llmEnabled: false, userDailyLimit: 0, estimate });
    await rejectsWith(estimates.estimateUsage(REQUEST), 'unavailable');
    expect(calls).toBe(0);
    expect(await setup({ llmEnabled: false }).quota.get()).toMatchObject({ remaining: 5 });
    expect(await quota.get()).toMatchObject({ limit: 0, remaining: 0 });
  });

  it('sem blocos não há o que estimar: responde a quota atual sem consumir, mesmo esgotada', async () => {
    const EMPTY = { ...REQUEST, blocks: [], edges: [] };
    const { estimates, quota } = setup({ userDailyLimit: 1 });
    const state = { limit: 1, remaining: 1, resetsAt: DAY_END };
    expect(await estimates.estimateUsage(EMPTY)).toEqual({ blocks: [], edges: [], quota: state });
    expect(await quota.get()).toEqual(state);
    await estimates.estimateUsage(REQUEST);
    expect((await estimates.estimateUsage(EMPTY)).quota).toEqual({ ...state, remaining: 0 });
    await rejectsExhausted(estimates.estimateUsage(REQUEST), 'user');
  });

  it.each([
    ['região fora da lista', { ...REQUEST, region: 'xx-nowhere-1' }],
    ['descrição acima do limite', { ...REQUEST, description: 'a'.repeat(2001) }],
    ['bloco sem id', { ...REQUEST, blocks: [{ type: 'aws.s3', attributes: {} }] }],
    ['sem arestas', { region: REQUEST.region, description: 'x', blocks: [] }],
    ['null', null],
  ])('invalid-request não consome quota: %s', async (_name, request) => {
    const { estimates, quota } = setup({ userDailyLimit: 1 });
    await rejectsWith(estimates.estimateUsage(badRequest(request)), 'invalid-request');
    expect((await quota.get()).remaining).toBe(1);
    await expect(estimates.estimateUsage(REQUEST)).resolves.toBeDefined();
  });

  it('precedência: invalid-request, unavailable, quota-exhausted', async () => {
    const off = setup({ llmEnabled: false, userDailyLimit: 0 });
    await rejectsWith(off.estimates.estimateUsage(badRequest(null)), 'invalid-request');
    await rejectsWith(off.estimates.estimateUsage(REQUEST), 'unavailable');
    const on = setup({ userDailyLimit: 0 });
    await rejectsWith(on.estimates.estimateUsage(badRequest(null)), 'invalid-request');
    await rejectsExhausted(on.estimates.estimateUsage(REQUEST), 'user');
  });
});

describe('createInMemoryApi: estado', () => {
  it('deleteAccount apaga os designs e zera a quota do usuário, mas não a global', async () => {
    const { designs, estimates, quota, account } = setup({
      userDailyLimit: 5,
      globalDailyLimit: 2,
    });
    await designs.create({ name: 'a', doc: SMALL_DOC });
    await estimates.estimateUsage(REQUEST);
    await estimates.estimateUsage(REQUEST);
    expect((await quota.get()).remaining).toBe(3);
    await account.deleteAccount();
    expect(await designs.list()).toEqual([]);
    expect((await quota.get()).remaining).toBe(5);
    await rejectsExhausted(estimates.estimateUsage(REQUEST), 'global');
  });

  it('a quota de uma instância não é consumida por outra', async () => {
    const one = setup({ userDailyLimit: 1, globalDailyLimit: 1 });
    const other = setup({ userDailyLimit: 1, globalDailyLimit: 1 });
    await one.estimates.estimateUsage(REQUEST);
    expect((await other.quota.get()).remaining).toBe(1);
    await expect(other.estimates.estimateUsage(REQUEST)).resolves.toBeDefined();
  });

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
    await rejectsWith(other.designs.update(d.id, { expectedVersion: 1, name: 'b' }), 'not-found');
    await rejectsWith(other.designs.duplicate(d.id, { name: 'b' }), 'not-found');
  });
});
