// @vitest-environment node
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { adrExampleDesign, designWithBlocks } from '../../../test/designFixtures';
import {
  designSchema,
  designSummarySchema,
  estimateResponseSchema,
  isApiError,
  quotaSchema,
  type Api,
  type ApiErrorKind,
  type EstimateRequest,
} from '../api';
import { createInMemoryApi, type InMemoryApiOptions } from '../api/inMemoryApi';
import { designDocumentSchema } from '../design';
import { createHttpApi, MAX_DESIGNS } from './httpApi';
import { createHttpTransport, type HttpTransport } from './transport';

const BASE = 'https://api.example.com/v1';
const TOKEN = 'cabecalho.corpo.assinatura';
const SERVER_TEXT = '<img src=x onerror=alert(1)>';
const SUB = 'sub-do-usuario-123';
const T0 = Date.parse('2026-11-25T10:00:00.000Z');
const RESETS_AT = '2026-11-26T00:00:00.000Z';
const DOC = designDocumentSchema.parse(adrExampleDesign);
const LARGE_DOC = designDocumentSchema.parse(designWithBlocks(5));
const UNKNOWN = '0'.repeat(26);
const ID = '01JDM5ZK7Q8R9S0T1V2W3X4Y5Z';
const BAD_IDS = ['', '.', '..', '../quota', 'a/b', `${ID}?x=1`, ID.toLowerCase()];
const ESTIMATE: EstimateRequest = {
  region: DOC.region,
  description: DOC.workload.description,
  blocks: DOC.blocks.map(({ id, type, attributes }) => ({ id, type, attributes })),
  edges: DOC.edges.map(({ id, source, target, kind }) => ({ id, source, target, kind })),
};

const server = setupServer();
const consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
  vi.spyOn(console, method),
);
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => {
  server.resetHandlers();
  for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
});
afterAll(() => server.close());

const STATUS: Readonly<Record<ApiErrorKind, number>> = {
  unauthenticated: 401,
  'not-found': 404,
  'version-conflict': 409,
  'design-limit': 409,
  'too-large': 413,
  'invalid-request': 422,
  'quota-exhausted': 429,
  unavailable: 503,
  'invalid-response': 500,
  network: 500,
};

/** Problem details como o backend emite, com texto que nunca pode chegar a quem chama. */
const problem = (status: number, extra: object = {}) =>
  HttpResponse.json(
    { type: 'about:blank', title: SERVER_TEXT, status, detail: SERVER_TEXT, ...extra },
    { status, headers: { 'Content-Type': 'application/problem+json' } },
  );

type Seen = { method: string; url: string; body: unknown; raw: string };

/** Servidor MSW com as rotas do backend, respondendo com o fake e traduzindo `ApiError` em status. */
function serve(backend: Api): Seen[] {
  const seen: Seen[] = [];
  const route = (
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
    run: (id: string, body: never) => Promise<unknown>,
    status = 200,
  ) =>
    http[method](`${BASE}${path}`, async ({ request, params }) => {
      const text = await request.text();
      const body: unknown = text === '' ? undefined : JSON.parse(text);
      const headers = JSON.stringify([...request.headers]);
      seen.push({ method: request.method, url: request.url, body, raw: text + headers });
      try {
        const data = await run(String(params.id), body as never);
        return data === undefined
          ? new HttpResponse(null, { status: 204 })
          : HttpResponse.json(data, { status });
      } catch (error) {
        if (!isApiError(error)) throw error;
        const { kind, ...extra } = error.detail;
        return problem(STATUS[kind], extra);
      }
    });
  const { designs, estimates, quota, account } = backend;
  server.use(
    route('get', '/designs', () => designs.list()),
    route('post', '/designs', (_, body) => designs.create(body), 201),
    route('get', '/designs/:id', (id) => designs.get(id)),
    route('patch', '/designs/:id', (id, body) => designs.update(id, body)),
    route('delete', '/designs/:id', (id) => designs.remove(id)),
    route('post', '/designs/:id/duplicate', (id, body) => designs.duplicate(id, body), 201),
    route('post', '/estimates', (_, body) => estimates.estimateUsage(body)),
    route('get', '/quota', () => quota.get()),
    route('delete', '/me', () => account.deleteAccount()),
  );
  return seen;
}

/** Responde o mesmo a qualquer rota e conta as requisições. */
function respond(resolver: () => Response): Request[] {
  const seen: Request[] = [];
  server.use(
    http.all(`${BASE}/*`, ({ request }) => {
      seen.push(request);
      return resolver();
    }),
  );
  return seen;
}

const transport = (getAccessToken: () => string | null = () => TOKEN) =>
  createHttpTransport({ baseUrl: BASE, getAccessToken, timeoutMs: 500 });
const httpApi = () => createHttpApi(transport());

type Target = { api: Api; advance: () => void; seen: Seen[] };

function fakeTarget(overrides: Partial<InMemoryApiOptions> = {}): Target {
  let t = T0;
  const api = createInMemoryApi({
    userDailyLimit: 5,
    globalDailyLimit: 30,
    maxDesigns: 50,
    maxDocBytes: 350_000,
    now: () => new Date(t),
    ...overrides,
  });
  return { api, advance: () => void (t += 1000), seen: [] };
}

function httpTarget(overrides: Partial<InMemoryApiOptions> = {}): Target {
  const backend = fakeTarget(overrides);
  return { api: httpApi(), advance: backend.advance, seen: serve(backend.api) };
}

async function failure(promise: Promise<unknown>) {
  const error: unknown = await promise.catch((reason: unknown) => reason);
  if (!isApiError(error)) throw new Error('esperava um ApiError');
  expect(error.message).not.toContain(SERVER_TEXT);
  expect(error.cause).toBeUndefined();
  return error;
}
const kindOf = async (promise: Promise<unknown>) => (await failure(promise)).kind;
/** Entrada fora do tipo: em runtime as portas recebem `unknown`. */
const bad = (value: unknown) => value as never;

/** A mesma suíte roda contra o fake e contra o adaptador HTTP: as telas trocam um pelo outro. */
describe.each([
  ['createInMemoryApi', fakeTarget],
  ['createHttpApi', httpTarget],
])('paridade das portas: %s', (_name, target) => {
  it('create, get e list: design gravado, resumo sem doc, do mais recente para o mais antigo', async () => {
    const { api, advance } = target();
    const first = await api.designs.create({ name: '  Primeiro  ', doc: DOC });
    advance();
    const second = await api.designs.create({ name: 'Segundo', doc: DOC });
    expect(designSchema.parse(first)).toEqual(first);
    expect(first).toMatchObject({ name: 'Primeiro', version: 1, blockCount: 2, doc: DOC });
    expect(await api.designs.get(first.id)).toEqual(first);
    const list = await api.designs.list();
    expect(list.map(({ id }) => id)).toEqual([second.id, first.id]);
    expect(list[0]).not.toHaveProperty('doc');
  });

  it('create: invalid-request, too-large e design-limit', async () => {
    const { api } = target({ maxDesigns: 1, maxDocBytes: 1000 });
    expect(await kindOf(api.designs.create(bad({ name: '', doc: DOC })))).toBe('invalid-request');
    expect(await kindOf(api.designs.create({ name: 'a', doc: LARGE_DOC }))).toBe('too-large');
    await api.designs.create({ name: 'a', doc: DOC });
    expect(await kindOf(api.designs.create({ name: 'b', doc: DOC }))).toBe('design-limit');
    expect(await api.designs.list()).toHaveLength(1);
  });

  it('get e remove: id desconhecido ou fora do formato não existe; remove é idempotente', async () => {
    const { api } = target();
    const design = await api.designs.create({ name: 'a', doc: DOC });
    for (const id of [UNKNOWN, ...BAD_IDS]) {
      expect(await kindOf(api.designs.get(id))).toBe('not-found');
      await expect(api.designs.remove(id)).resolves.toBeUndefined();
    }
    await expect(api.designs.remove(design.id)).resolves.toBeUndefined();
    await expect(api.designs.remove(design.id)).resolves.toBeUndefined();
    expect(await kindOf(api.designs.get(design.id))).toBe('not-found');
  });

  it('update: grava e incrementa a versão; versão antiga dá version-conflict sem gravar', async () => {
    const { api, advance } = target({ maxDocBytes: 1000 });
    const design = await api.designs.create({ name: 'a', doc: DOC });
    advance();
    const renamed = await api.designs.update(design.id, { expectedVersion: 1, name: ' b ' });
    expect(renamed).toMatchObject({ id: design.id, name: 'b', version: 2, doc: DOC });
    expect(renamed.updatedAt > design.updatedAt).toBe(true);
    const stale = api.designs.update(design.id, { expectedVersion: 1, name: 'c' });
    expect(await kindOf(stale)).toBe('version-conflict');
    expect(await api.designs.get(design.id)).toEqual(renamed);
    const { update } = api.designs;
    expect(await kindOf(update(design.id, bad({ expectedVersion: 2 })))).toBe('invalid-request');
    expect(await kindOf(update(UNKNOWN, { expectedVersion: 1, name: 'c' }))).toBe('not-found');
    expect(await kindOf(update('..', { expectedVersion: 1, name: 'c' }))).toBe('not-found');
    expect(await kindOf(update(design.id, { expectedVersion: 2, doc: LARGE_DOC }))).toBe(
      'too-large',
    );
  });

  it('duplicate: cópia com outro nome e versão 1; not-found, invalid-request e design-limit', async () => {
    const { api } = target({ maxDesigns: 2 });
    const design = await api.designs.create({ name: 'a', doc: DOC });
    expect(await kindOf(api.designs.duplicate(UNKNOWN, { name: 'b' }))).toBe('not-found');
    expect(await kindOf(api.designs.duplicate('a/b', { name: 'b' }))).toBe('not-found');
    expect(await kindOf(api.designs.duplicate(design.id, { name: ' ' }))).toBe('invalid-request');
    const copy = await api.designs.duplicate(design.id, { name: 'b' });
    expect(copy).toMatchObject({ name: 'b', version: 1, doc: DOC });
    expect(copy.id).not.toBe(design.id);
    expect(await kindOf(api.designs.duplicate(design.id, { name: 'c' }))).toBe('design-limit');
  });

  it('estimateUsage consome a quota; quota.get lê sem consumir', async () => {
    const { api } = target();
    const quota = { limit: 5, remaining: 5, resetsAt: RESETS_AT };
    expect(await api.quota.get()).toEqual(quota);
    const response = await api.estimates.estimateUsage(ESTIMATE);
    expect(estimateResponseSchema.parse(response)).toEqual(response);
    expect(response.blocks.map(({ id }) => id)).toEqual(DOC.blocks.map(({ id }) => id));
    expect(response.quota).toEqual({ ...quota, remaining: 4 });
    expect(await api.quota.get()).toEqual({ ...quota, remaining: 4 });
    const invalid = api.estimates.estimateUsage(bad({ ...ESTIMATE, region: 'xx-nowhere-9' }));
    expect(await kindOf(invalid)).toBe('invalid-request');
  });

  it.each([
    ['user', { userDailyLimit: 0 }],
    ['global', { globalDailyLimit: 0 }],
  ] as const)('quota-exhausted leva scope %s e resetsAt', async (scope, overrides) => {
    const error = await failure(target(overrides).api.estimates.estimateUsage(ESTIMATE));
    expect(error.detail).toEqual({ kind: 'quota-exhausted', scope, resetsAt: RESETS_AT });
  });

  it('estimateUsage com a LLM desligada dá unavailable sem consumir quota', async () => {
    const { api } = target({ llmEnabled: false });
    expect(await kindOf(api.estimates.estimateUsage(ESTIMATE))).toBe('unavailable');
    expect((await api.quota.get()).remaining).toBe(5);
  });

  it('deleteAccount apaga os designs e zera a quota do usuário', async () => {
    const { api } = target();
    const design = await api.designs.create({ name: 'a', doc: DOC });
    await api.estimates.estimateUsage(ESTIMATE);
    await expect(api.account.deleteAccount()).resolves.toBeUndefined();
    expect(await api.designs.list()).toEqual([]);
    expect(await kindOf(api.designs.get(design.id))).toBe('not-found');
    expect((await api.quota.get()).remaining).toBe(5);
  });
});

/** Uma chamada de cada método das portas, com entrada válida. */
const CALLS: ReadonlyArray<readonly [string, (api: Api, id: string) => Promise<unknown>]> = [
  ['designs.list', (api) => api.designs.list()],
  ['designs.get', (api, id) => api.designs.get(id)],
  ['designs.create', (api) => api.designs.create({ name: 'a', doc: DOC })],
  ['designs.update', (api, id) => api.designs.update(id, { expectedVersion: 1, name: 'b' })],
  ['designs.duplicate', (api, id) => api.designs.duplicate(id, { name: 'c' })],
  ['designs.remove', (api, id) => api.designs.remove(id)],
  ['estimates.estimateUsage', (api) => api.estimates.estimateUsage(ESTIMATE)],
  ['quota.get', (api) => api.quota.get()],
  ['account.deleteAccount', (api) => api.account.deleteAccount()],
];

describe('createHttpApi: rotas', () => {
  it('cada método usa o método HTTP, o caminho e o corpo do contrato, sem identidade do usuário', async () => {
    const { api, seen } = httpTarget({ newId: () => ID });
    // Chaves fora do contrato (inclusive identidade) na entrada não saem na requisição.
    const spoof = { userId: SUB, sub: SUB, ownerId: SUB };
    const doc = { ...DOC, ...spoof, workload: { ...DOC.workload, ...spoof } };
    await api.designs.create(bad({ name: ' a ', doc, ...spoof }));
    await api.designs.list();
    await api.designs.get(ID);
    await api.designs.update(ID, bad({ expectedVersion: 1, name: 'b', ...spoof }));
    await api.designs.update(ID, bad({ expectedVersion: 2, doc, ...spoof }));
    await api.designs.remove(ID);
    await api.estimates.estimateUsage(bad({ ...ESTIMATE, ...spoof }));
    await api.quota.get();
    await api.account.deleteAccount();
    expect(seen.map(({ method, url, body }) => ({ method, url, body }))).toEqual([
      { method: 'POST', url: `${BASE}/designs`, body: { name: 'a', doc: DOC } },
      { method: 'GET', url: `${BASE}/designs`, body: undefined },
      { method: 'GET', url: `${BASE}/designs/${ID}`, body: undefined },
      { method: 'PATCH', url: `${BASE}/designs/${ID}`, body: { expectedVersion: 1, name: 'b' } },
      { method: 'PATCH', url: `${BASE}/designs/${ID}`, body: { expectedVersion: 2, doc: DOC } },
      { method: 'DELETE', url: `${BASE}/designs/${ID}`, body: undefined },
      { method: 'POST', url: `${BASE}/estimates`, body: ESTIMATE },
      { method: 'GET', url: `${BASE}/quota`, body: undefined },
      { method: 'DELETE', url: `${BASE}/me`, body: undefined },
    ]);
    for (const { raw, url } of seen) expect(raw + url).not.toContain(SUB);
  });

  it('o id vai como segmento do transporte, nunca concatenado, com o 409 de cada rota', async () => {
    const request = vi.fn(() => Promise.resolve(undefined));
    const api = createHttpApi({ request } as unknown as HttpTransport);
    await api.designs.get(ID);
    await api.designs.create({ name: 'a', doc: DOC });
    await api.designs.update(ID, { expectedVersion: 1, name: 'b' });
    await api.designs.duplicate(ID, { name: 'c' });
    await api.designs.remove(ID);
    expect(request.mock.calls.map(([req]: unknown[]) => req)).toEqual([
      { method: 'GET', path: ['designs', ID] },
      {
        method: 'POST',
        path: ['designs'],
        body: { name: 'a', doc: DOC },
        conflict: 'design-limit',
      },
      {
        method: 'PATCH',
        path: ['designs', ID],
        body: { expectedVersion: 1, name: 'b' },
        conflict: 'version-conflict',
      },
      {
        method: 'POST',
        path: ['designs', ID, 'duplicate'],
        body: { name: 'c' },
        conflict: 'design-limit',
      },
      { method: 'DELETE', path: ['designs', ID] },
    ]);
  });

  it('409 é design-limit em create e duplicate e version-conflict em update', async () => {
    respond(() => problem(409));
    const { designs } = httpApi();
    expect(await kindOf(designs.create({ name: 'a', doc: DOC }))).toBe('design-limit');
    expect(await kindOf(designs.duplicate(ID, { name: 'a' }))).toBe('design-limit');
    expect(await kindOf(designs.update(ID, { expectedVersion: 1, name: 'a' }))).toBe(
      'version-conflict',
    );
  });

  it('429 de quota em estimateUsage leva só scope e resetsAt', async () => {
    respond(() => problem(429, { scope: 'global', resetsAt: RESETS_AT, userId: SUB }));
    const error = await failure(httpApi().estimates.estimateUsage(ESTIMATE));
    expect(error.detail).toEqual({ kind: 'quota-exhausted', scope: 'global', resetsAt: RESETS_AT });
  });
});

describe('createHttpApi: entrada', () => {
  const invalid: ReadonlyArray<readonly [string, (api: Api) => Promise<unknown>]> = [
    ['create sem doc', (api) => api.designs.create(bad({ name: 'a' }))],
    ['create com nome longo', (api) => api.designs.create({ name: 'a'.repeat(81), doc: DOC })],
    ['update sem name nem doc', (api) => api.designs.update(ID, bad({ expectedVersion: 1 }))],
    ['update com versão 0', (api) => api.designs.update(ID, { expectedVersion: 0, name: 'a' })],
    ['update com id inválido', (api) => api.designs.update('..', bad({ name: 'a' }))],
    ['duplicate sem nome', (api) => api.designs.duplicate(ID, bad({}))],
    ['estimateUsage sem blocos', (api) => api.estimates.estimateUsage(bad({ region: DOC.region }))],
    ['estimateUsage nulo', (api) => api.estimates.estimateUsage(bad(null))],
  ];

  it.each(invalid)('%s dá invalid-request sem chamar a API', async (_name, call) => {
    const seen = respond(() => HttpResponse.json({}));
    expect(await kindOf(call(httpApi()))).toBe('invalid-request');
    expect(seen).toHaveLength(0);
  });

  it('id fora do formato não vira requisição em nenhum método', async () => {
    const seen = respond(() => HttpResponse.json({}));
    const { designs } = httpApi();
    for (const id of [...BAD_IDS, bad(null)]) {
      expect(await kindOf(designs.get(id))).toBe('not-found');
      expect(await kindOf(designs.update(id, { expectedVersion: 1, name: 'a' }))).toBe('not-found');
      expect(await kindOf(designs.duplicate(id, { name: 'a' }))).toBe('not-found');
      await expect(designs.remove(id)).resolves.toBeUndefined();
    }
    expect(seen).toHaveLength(0);
  });
});

describe('createHttpApi: resposta e erros de transporte', () => {
  it('descarta chave desconhecida da resposta de cada rota', async () => {
    const backend = fakeTarget({ newId: () => ID });
    const design = await backend.api.designs.create({ name: 'a', doc: DOC });
    const summary = designSummarySchema.parse(design);
    const quota = await backend.api.quota.get();
    const estimate = { blocks: [], edges: [], quota: { ...quota, extra: SERVER_TEXT } };
    const extra = { ownerId: SUB, extra: SERVER_TEXT };
    let payload: object = { ...design, ...extra, doc: { ...DOC, ...extra } };
    respond(() => HttpResponse.json(payload));
    const api = httpApi();
    expect(await api.designs.get(ID)).toEqual(design);
    expect(await api.designs.create({ name: 'a', doc: DOC })).toEqual(design);
    expect(await api.designs.update(ID, { expectedVersion: 1, name: 'a' })).toEqual(design);
    expect(await api.designs.duplicate(ID, { name: 'a' })).toEqual(design);
    payload = [{ ...design, ...extra }];
    expect(await api.designs.list()).toEqual([summary]);
    payload = { ...quota, ...extra };
    expect(await api.quota.get()).toEqual(quotaSchema.parse(quota));
    payload = { ...estimate, ...extra };
    expect(await api.estimates.estimateUsage(ESTIMATE)).toEqual({ blocks: [], edges: [], quota });
  });

  it.each(CALLS)('%s: resposta fora do schema dá invalid-response', async (_name, call) => {
    respond(() => HttpResponse.json({ id: SERVER_TEXT, limit: -1, blocks: SERVER_TEXT }));
    expect(await kindOf(call(httpApi(), ID))).toBe('invalid-response');
  });

  it('listagem acima do limite de designs dá invalid-response', async () => {
    const design = await fakeTarget({ newId: () => ID }).api.designs.create({
      name: 'a',
      doc: DOC,
    });
    let count = MAX_DESIGNS;
    respond(() => HttpResponse.json(Array.from({ length: count }, () => design)));
    expect(await httpApi().designs.list()).toHaveLength(MAX_DESIGNS);
    count += 1;
    expect(await kindOf(httpApi().designs.list())).toBe('invalid-response');
  });

  it.each(CALLS)('%s: 401, 5xx, falha de rede e falta de token', async (_name, call) => {
    let response = () => problem(401);
    const seen = respond(() => response());
    expect(await kindOf(call(httpApi(), ID))).toBe('unauthenticated');
    response = () => problem(503);
    expect(await kindOf(call(httpApi(), ID))).toBe('unavailable');
    response = () => HttpResponse.error();
    expect(await kindOf(call(httpApi(), ID))).toBe('network');
    expect(seen).toHaveLength(3);
    const signedOut = createHttpApi(transport(() => null));
    expect(await kindOf(call(signedOut, ID))).toBe('unauthenticated');
    expect(seen).toHaveLength(3);
  });
});
