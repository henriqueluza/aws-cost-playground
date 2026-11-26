// @vitest-environment node
import { delay, http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { isApiError, type ApiErrorKind } from '../api';
import { createHttpTransport, MAX_RESPONSE_BYTES, type HttpRequest } from './transport';

const BASE = 'https://api.example.com';
const TOKEN = 'cabecalho.corpo.assinatura';
const SERVER_TEXT = '<img src=x onerror=alert(1)>';
const schema = z.object({ ok: z.literal(true) });
const get: HttpRequest = { method: 'GET', path: ['quota'] };

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

const transport = (getAccessToken: () => Promise<string | null> | string | null = () => TOKEN) =>
  createHttpTransport({ baseUrl: BASE, getAccessToken, timeoutMs: 200 });

/** Responde a qualquer rota da API e guarda as requisições recebidas. */
function respond(resolver: () => Response | Promise<Response>): Request[] {
  const seen: Request[] = [];
  server.use(
    http.all(`${BASE}/*`, ({ request }) => {
      seen.push(request.clone());
      return resolver();
    }),
  );
  return seen;
}

const RESETS_AT = '2026-12-01T00:00:00Z';
const json = (body: BodyInit) =>
  new HttpResponse(body, { headers: { 'Content-Type': 'application/json' } });
const problem = (status: number, extra: object = {}) =>
  HttpResponse.json(
    { type: 'about:blank', title: SERVER_TEXT, status, detail: SERVER_TEXT, ...extra },
    { status, headers: { 'Content-Type': 'application/problem+json' } },
  );

async function failure(promise: Promise<unknown>) {
  const error: unknown = await promise.catch((reason: unknown) => reason);
  if (!isApiError(error)) throw new Error('esperava um ApiError');
  return error;
}

describe('requisição', () => {
  it('manda o token só em Authorization, sem cookies, para a origem configurada', async () => {
    const seen = respond(() => HttpResponse.json({ ok: true, extra: 'descartado' }));
    const body = { name: 'Meu design' };
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const result = await transport().request(
      { method: 'POST', path: ['designs', 'a/b ?c#d'], body },
      schema,
    );

    expect(result).toEqual({ ok: true });
    const [request] = seen;
    expect(request?.url).toBe(`${BASE}/designs/a%2Fb%20%3Fc%23d`);
    expect(request?.url).not.toContain(TOKEN);
    expect(request?.headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
    expect(request?.headers.get('cookie')).toBeNull();
    expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
    fetchSpy.mockRestore();
    expect(request?.headers.get('content-type')).toBe('application/json');
    expect(await request?.json()).toEqual(body);
  });

  it('pede o token ao provedor a cada requisição, sem guardá-lo', async () => {
    const seen = respond(() => HttpResponse.json({ ok: true }));
    const tokens = ['primeiro.token.a', 'segundo.token.b'];
    const client = transport(() => tokens.shift() ?? null);

    await client.request(get, schema);
    await client.request(get, schema);
    const third = await failure(client.request(get, schema));

    expect(seen.map((request) => request.headers.get('authorization'))).toEqual([
      'Bearer primeiro.token.a',
      'Bearer segundo.token.b',
    ]);
    expect(third.kind).toBe('unauthenticated');
  });

  it.each([
    ['sem sessão', () => null],
    ['provedor que falha', () => Promise.reject(new Error('falhou'))],
    ['token com quebra de linha', () => 'abc\r\nX-Outro: 1'],
  ])('%s: unauthenticated sem chamar a API', async (_name, getAccessToken) => {
    const seen = respond(() => HttpResponse.json({ ok: true }));
    const error = await failure(transport(getAccessToken).request(get, schema));
    expect(error.kind).toBe('unauthenticated');
    expect(seen).toHaveLength(0);
  });

  it.each([[['designs', '..']], [['.']], [['designs', '']], [[]]])(
    'caminho %j: invalid-request sem chamar a API',
    async (path) => {
      const seen = respond(() => HttpResponse.json({ ok: true }));
      const error = await failure(transport().request({ method: 'GET', path }, schema));
      expect(error.kind).toBe('invalid-request');
      expect(seen).toHaveLength(0);
    },
  );

  it('preserva o prefixo de caminho da URL base', async () => {
    const seen = respond(() => HttpResponse.json({ ok: true }));
    const client = createHttpTransport({ baseUrl: `${BASE}/v1/`, getAccessToken: () => TOKEN });
    await client.request(get, schema);
    expect(seen[0]?.url).toBe(`${BASE}/v1/quota`);
  });

  it.each([
    'http://api.example.com',
    'https://usuario:senha@api.example.com',
    'https://api.example.com/?x=1',
    'javascript:alert(1)',
    '/relativa',
  ])('recusa a URL base %s', (baseUrl) => {
    expect(() => createHttpTransport({ baseUrl, getAccessToken: () => TOKEN })).toThrow();
  });
});

describe('erros HTTP', () => {
  it.each<[number, ApiErrorKind, HttpRequest['conflict']?]>([
    [400, 'invalid-request'],
    [401, 'unauthenticated'],
    [403, 'unauthenticated'],
    [404, 'not-found'],
    [409, 'version-conflict'],
    [409, 'design-limit', 'design-limit'],
    [413, 'too-large'],
    [422, 'invalid-request'],
    [429, 'unavailable'],
    [500, 'unavailable'],
    [503, 'unavailable'],
    [418, 'invalid-response'],
  ])('%i vira %s, sem texto do servidor', async (status, kind, conflict) => {
    respond(() => problem(status));
    const error = await failure(transport().request({ ...get, conflict }, schema));

    expect(error.detail).toEqual({ kind });
    expect(error.message).toBe(`Erro da API: ${kind}.`);
    expect(error.cause).toBeUndefined();
    expect(JSON.stringify(error)).not.toContain('onerror');
  });

  it('429 de quota traz scope e resetsAt validados', async () => {
    const quota = { scope: 'global', resetsAt: RESETS_AT };
    respond(() => problem(429, { ...quota, extra: SERVER_TEXT }));
    const error = await failure(transport().request(get, schema));
    expect(error.detail).toEqual({ kind: 'quota-exhausted', ...quota });
  });

  it.each([
    ['scope desconhecido', () => problem(429, { scope: 'admin', resetsAt: RESETS_AT })],
    ['resetsAt que não é data', () => problem(429, { scope: 'user', resetsAt: SERVER_TEXT })],
    ['corpo que não é JSON', () => HttpResponse.text('Too Many Requests', { status: 429 })],
  ])('429 com %s vira unavailable', async (_name, resolver) => {
    respond(resolver);
    expect((await failure(transport().request(get, schema))).kind).toBe('unavailable');
  });
});

describe('resposta', () => {
  it('sem corpo (204) passa por z.void()', async () => {
    respond(() => new HttpResponse(null, { status: 204 }));
    const request: HttpRequest = { method: 'DELETE', path: ['me'] };
    await expect(transport().request(request, z.void())).resolves.toBeUndefined();
  });

  const big = 'x'.repeat(MAX_RESPONSE_BYTES);
  it.each([
    ['fora do schema', () => HttpResponse.json({ ok: 'sim' })],
    ['vazia onde o schema pede corpo', () => new HttpResponse(null, { status: 200 })],
    ['que não é JSON', () => HttpResponse.html('<p>{"ok":true}</p>')],
    ['com JSON quebrado', () => json('{')],
    ['maior que o limite', () => HttpResponse.json({ ok: true, big })],
    ['maior que o limite, em fluxo', () => json(new Blob([`{"ok":true,"big":"${big}"}`]).stream())],
  ])('%s vira invalid-response', async (_name, resolver) => {
    respond(resolver);
    expect((await failure(transport().request(get, schema))).kind).toBe('invalid-response');
  });
});

describe('rede', () => {
  it('falha de rede vira network, sem cause', async () => {
    respond(() => HttpResponse.error());
    const error = await failure(transport().request(get, schema));
    expect(error.kind).toBe('network');
    expect(error.cause).toBeUndefined();
  });

  it('estoura o tempo limite e vira network', async () => {
    respond(async () => {
      await delay('infinite');
      return HttpResponse.json({ ok: true });
    });
    expect((await failure(transport().request(get, schema))).kind).toBe('network');
  });

  it('não segue redirecionamento: o token não chega a outra origem', async () => {
    const other: Request[] = [];
    server.use(
      http.all('https://outra.example.net/*', ({ request }) => {
        other.push(request);
        return HttpResponse.json({ ok: true });
      }),
    );
    respond(() => HttpResponse.redirect('https://outra.example.net/quota', 307));
    expect((await failure(transport().request(get, schema))).kind).toBe('network');
    expect(other).toHaveLength(0);
  });
});
