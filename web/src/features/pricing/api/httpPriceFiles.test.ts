// @vitest-environment node
import { createHash } from 'node:crypto';
import { delay, http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CatalogError, createCatalogLoader, httpPriceFiles, type CatalogErrorKind } from '..';
import { MAX_PRICE_FILE_BYTES } from './httpPriceFiles';

const ORIGIN = 'https://app.example.com';
const SERVER_TEXT = '<img src=x onerror=alert(1)>';
const LAMBDA = 'us-east-1/lambda.json';

const server = setupServer();
const consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
  vi.spyOn(console, method),
);
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => vi.stubGlobal('location', { origin: ORIGIN }));
afterEach(() => {
  server.resetHandlers();
  vi.unstubAllGlobals();
  for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
});
afterAll(() => server.close());

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const priceFile = (extra: object = {}) =>
  encode({ schemaVersion: 1, service: 'lambda', region: 'us-east-1', currency: 'USD', ...extra });
const manifestFor = (bytes: Uint8Array) =>
  encode({
    schemaVersion: 1,
    source: 'seed',
    generatedAt: '2026-11-23T12:00:00Z',
    files: [{ path: LAMBDA, sha256: createHash('sha256').update(bytes).digest('hex') }],
  });

type Resolver = () => Response | Promise<Response>;

/** Serve `/prices/*` da própria origem e guarda as requisições recebidas. */
function serve(files: Record<string, Resolver | Uint8Array<ArrayBuffer>>): Request[] {
  const seen: Request[] = [];
  server.use(
    http.all(`${ORIGIN}/prices/*`, ({ request }) => {
      seen.push(request.clone());
      const file = files[new URL(request.url).pathname.slice('/prices/'.length)];
      if (file instanceof Uint8Array) return new HttpResponse(file);
      return file ? file() : new HttpResponse(SERVER_TEXT, { status: 404 });
    }),
  );
  return seen;
}

/** Catálogo com um arquivo listado; `served` troca o que o servidor entrega para ele. */
function catalog(listed = priceFile({ prices: [] }), served?: Resolver | Uint8Array<ArrayBuffer>) {
  return serve({ 'manifest.json': manifestFor(listed), [LAMBDA]: served ?? listed });
}

async function failure(promise: Promise<unknown>): Promise<CatalogError> {
  const error: unknown = await promise.catch((reason: unknown) => reason);
  if (!(error instanceof CatalogError)) throw new Error('esperava um CatalogError');
  // Mensagem fixa, sem `cause`: nada do servidor, da URL ou da exceção original.
  expect(error.message).toBe(`Erro do catálogo de preços: ${error.kind}.`);
  expect(error.cause).toBeUndefined();
  return error;
}

/** Corpo em pedaços de 64 KiB, sem fim; conta quantos pedaços foram puxados. */
function endless() {
  const state = { pulled: 0 };
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      state.pulled += 1;
      controller.enqueue(new Uint8Array(64 * 1024));
    },
  });
  return { state, body };
}

describe('httpPriceFiles com createCatalogLoader', () => {
  it('carrega o catálogo de /prices/ na mesma origem, com o sha256 conferido', async () => {
    const seen = catalog();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const loader = createCatalogLoader(httpPriceFiles());
    const loaded = await loader.load('us-east-1', ['lambda', 'rds']);
    expect([...loaded.services.keys()]).toEqual(['lambda']);
    expect(loaded.manifest.source).toBe('seed');
    expect(seen.map((request) => [request.method, request.url])).toEqual([
      ['GET', `${ORIGIN}/prices/manifest.json`],
      ['GET', `${ORIGIN}/prices/${LAMBDA}`],
    ]);
    for (const request of seen) {
      expect(request.headers.get('authorization')).toBeNull();
      expect(request.headers.get('cookie')).toBeNull();
    }
    for (const [, init] of fetchSpy.mock.calls) {
      expect(init).toMatchObject({
        method: 'GET',
        mode: 'same-origin',
        cache: 'no-cache',
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
      });
      expect(init).not.toHaveProperty('headers');
    }
    fetchSpy.mockRestore();
  });

  it.each<[string, CatalogErrorKind, () => Request[]]>([
    ['manifest ausente (404)', 'missing', () => serve({})],
    ['arquivo listado ausente (404)', 'missing', () => serve({ 'manifest.json': manifestFor(priceFile()) })], // prettier-ignore
    ['arquivo fora do schema', 'invalid', () => catalog(priceFile({ prices: SERVER_TEXT }))],
    ['arquivo que não é JSON', 'invalid', () => catalog(new TextEncoder().encode(SERVER_TEXT))],
    ['arquivo diferente do manifest', 'integrity', () => catalog(priceFile({ prices: [] }), priceFile({ prices: [], x: 1 }))], // prettier-ignore
    ['arquivo acima do teto', 'too-large', () => catalog(priceFile(), new Uint8Array(MAX_PRICE_FILE_BYTES + 1))], // prettier-ignore
    ['falha de rede no arquivo', 'network', () => catalog(priceFile(), () => HttpResponse.error())],
  ])('%s: %s', async (_name, kind, arrange) => {
    arrange();
    const loader = createCatalogLoader(httpPriceFiles());
    expect((await failure(loader.load('us-east-1', ['lambda']))).kind).toBe(kind);
  });
});

describe('httpPriceFiles: resposta', () => {
  const read = httpPriceFiles({ timeoutMs: 200 });

  it('devolve os bytes exatos do corpo, inclusive no tamanho do teto', async () => {
    const exact = new Uint8Array(MAX_PRICE_FILE_BYTES).fill(7);
    serve({ 'manifest.json': exact, [LAMBDA]: () => new HttpResponse(null) });
    expect(await read('manifest.json')).toEqual(exact);
    expect(await read(LAMBDA)).toEqual(new Uint8Array(0));
  });

  it.each([201, 204, 206, 304, 400, 401, 403, 500, 503])('status %i: network', async (status) => {
    const body = [204, 304].includes(status) ? null : SERVER_TEXT;
    serve({ 'manifest.json': () => new HttpResponse(body, { status }) });
    expect((await failure(read('manifest.json'))).kind).toBe('network');
  });

  it('não segue redirecionamento', async () => {
    const elsewhere = vi.fn(() => HttpResponse.json({}));
    server.use(http.get('https://evil.example.com/*', elsewhere));
    serve({
      'manifest.json': () =>
        new HttpResponse(null, {
          status: 302,
          headers: { Location: 'https://evil.example.com/prices/manifest.json' },
        }),
    });
    expect((await failure(read('manifest.json'))).kind).toBe('network');
    expect(elsewhere).not.toHaveBeenCalled();
  });

  it.each<[string, Resolver]>([
    ['falha de rede', () => HttpResponse.error()],
    ['tempo limite antes da resposta', async () => (await delay(2_000), new HttpResponse('{}'))],
    ['tempo limite no meio do corpo', () => new HttpResponse(new ReadableStream({ start() {} }))],
    ['corpo interrompido', () => new HttpResponse(new ReadableStream({ start: (c) => c.error(new Error(SERVER_TEXT)) }))], // prettier-ignore
  ])('%s: network', async (_name, resolver) => {
    serve({ 'manifest.json': resolver });
    expect((await failure(read('manifest.json'))).kind).toBe('network');
  });

  it('corta a leitura ao passar do teto, sem Content-Length, e para de puxar o corpo', async () => {
    const { state, body } = endless();
    serve({ [LAMBDA]: () => new HttpResponse(body) });
    expect((await failure(read(LAMBDA))).kind).toBe('too-large');
    const pulled = state.pulled;
    expect(pulled * 64 * 1024).toBeLessThan(MAX_PRICE_FILE_BYTES * 2);
    await delay(50);
    expect(state.pulled).toBe(pulled);
  });
});

describe('httpPriceFiles: caminho', () => {
  it.each([
    'manifest.json',
    'us-east-1/lambda.json',
    'sa-east-1/api-gateway-http.json',
    `us-east-1/a${'b'.repeat(39)}.json`,
  ])('aceita %s', async (path) => {
    const seen = serve({ [path]: new Uint8Array([1]) });
    await httpPriceFiles()(path);
    expect(seen.map((request) => request.url)).toEqual([`${ORIGIN}/prices/${path}`]);
  });

  it.each([
    '',
    'manifest',
    'manifest.json ',
    'manifest.json\n',
    'Manifest.json',
    'other.json',
    'us-east-1/manifest.json/x.json',
    '/manifest.json',
    '//evil.example.com/manifest.json',
    'https://evil.example.com/manifest.json',
    'http://app.example.com/prices/manifest.json',
    'javascript:alert(1)',
    'data:application/json,{}',
    '../config.json',
    'us-east-1/../manifest.json',
    'us-east-1/..json',
    './manifest.json',
    'us-east-1\\lambda.json',
    '\\\\evil.example.com\\manifest.json',
    'manifest.json?x=1',
    'us-east-1/lambda.json?x=1',
    'manifest.json#x',
    'us-east-1/lambda.json#x',
    'us-east-1%2Flambda.json',
    'us-east-1/%2e%2e.json',
    'us-east-1/lambda%00.json',
    'us-east-1/lambda\u0000.json',
    'us-east-1/lambda.json/',
    'us-east-1//lambda.json',
    'us-east-1/sub/lambda.json',
    'eu-west-1/lambda.json',
    'US-EAST-1/lambda.json',
    'us-east-1/Lambda.json',
    'us-east-1/1lambda.json',
    'us-east-1/lam_bda.json',
    'us-east-1/lambda.json.txt',
    'us-east-1/lambda.JSON',
    'us-east-1/lambdа.json',
    `us-east-1/a${'b'.repeat(40)}.json`,
    'user:pass@evil.example.com/x.json',
    ['manifest.json'] as unknown as string,
    undefined as unknown as string,
  ])('recusa %j sem requisição', async (path) => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    expect((await failure(httpPriceFiles()(path))).kind).toBe('invalid');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it.each([
    ['origem opaca', { origin: 'null' }],
    ['origem com caminho', { origin: `${ORIGIN}/outra` }],
    ['origem com credenciais', { origin: 'https://user:pass@app.example.com' }],
    ['origem com barra final', { origin: `${ORIGIN}/` }],
    ['sem location', undefined],
  ])('%s: invalid sem requisição', async (_name, location) => {
    vi.stubGlobal('location', location);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    expect((await failure(httpPriceFiles()('manifest.json'))).kind).toBe('invalid');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
