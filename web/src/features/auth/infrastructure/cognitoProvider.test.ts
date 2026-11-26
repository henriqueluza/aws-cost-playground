// @vitest-environment node
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { NOW } from '../../../test/authFixtures';
import {
  AUTH_ORIGIN,
  CLIENT_ID,
  createFakeCognito,
  DISCOVERY_URL,
  ISSUER,
  REDIRECT_URI as CB,
  TOKEN_URL,
  type FakeCognitoOptions,
} from '../../../test/fakeCognito';
import type { LoginAttempt, LoginAttemptStore } from '../application/ports';
import { AuthError, type AuthErrorKind } from '../model/authError';
import { createCognitoProvider } from './cognitoProvider';
import { createSessionAttemptStore } from './sessionAttemptStore';

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

const DOC = { issuer: ISSUER, authorization_endpoint: `${AUTH_ORIGIN}/oauth2/authorize` };
const BASE = { ...DOC, token_endpoint: TOKEN_URL };
type Body = Record<string, unknown>;

function setup(options: FakeCognitoOptions = {}) {
  const cognito = createFakeCognito(options);
  server.use(...cognito.handlers);
  const data = new Map<string, string>();
  const storage = {
    get length() {
      return data.size;
    },
    getItem: (key: string) => data.get(key) ?? null,
    removeItem: (key: string) => void data.delete(key),
    setItem: (key: string, value: string) => void data.set(key, value),
  } as Storage;
  const clock = { now: NOW };
  const calls: RequestInit[] = [];
  const spyFetch: typeof fetch = (input, init) => {
    calls.push(init ?? {});
    return fetch(input, init);
  };
  const config = { authority: ISSUER, clientId: CLIENT_ID, redirectUri: CB };
  const attempts = createSessionAttemptStore(storage);
  const provider = createCognitoProvider({
    ...config,
    attempts,
    fetch: spyFetch,
    now: () => clock.now,
  });
  return { cognito, storage, attempts, calls, provider, clock, config };
}

async function failure(promise: Promise<unknown>): Promise<AuthError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AuthError);
  return error as AuthError;
}
const expectKind = async (promise: Promise<unknown>, kind: AuthErrorKind) =>
  expect((await failure(promise)).kind).toBe(kind);

describe('beginSignIn', () => {
  it('monta o pedido de código com PKCE S256, escopo exato e tentativa sem token', async () => {
    const s = setup();
    const url = new URL(await s.provider.beginSignIn('sign-in', '/designs'));
    expect(`${url.origin}${url.pathname}`).toBe(`${AUTH_ORIGIN}/oauth2/authorize`);
    const p = url.searchParams;
    expect(p.get('response_type')).toBe('code');
    expect(p.get('scope')).toBe('openid email');
    expect(p.get('client_id')).toBe(CLIENT_ID);
    expect(p.get('redirect_uri')).toBe(CB);
    expect(p.get('code_challenge_method')).toBe('S256');
    for (const name of ['code_challenge', 'state', 'nonce']) {
      expect(p.get(name)).toMatch(/^[\w-]{43}$/);
    }
    expect(p.has('client_secret') || url.hash !== '').toBe(false);
    const saved = s.attempts.take();
    expect(saved?.verifier).toHaveLength(86);
    expect(url.toString()).not.toContain(saved?.verifier ?? '?');
    expect(saved?.state).toBe(p.get('state'));
    expect(Object.keys(saved ?? {}).sort()).toEqual(
      ['createdAt', 'nonce', 'returnTo', 'state', 'verifier'].sort(),
    );
  });

  it.each([
    ['sign-up', '/signup'],
    ['forgot-password', '/forgotPassword'],
  ] as const)('a tela %s fica na mesma origem validada', async (screen, path) => {
    const url = new URL(await setup().provider.beginSignIn(screen, '/'));
    expect([url.origin, url.pathname]).toEqual([AUTH_ORIGIN, path]);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });

  it('cada tentativa tem state, nonce e verificador novos', async () => {
    const s = setup();
    await s.provider.beginSignIn('sign-in', '/');
    const first = s.attempts.take() as LoginAttempt;
    await s.provider.beginSignIn('sign-in', '/');
    const second = s.attempts.take() as LoginAttempt;
    expect(new Set([first.state, second.state, first.nonce, second.nonce]).size).toBe(4);
    expect(first.verifier).not.toBe(second.verifier);
  });

  it('armazenamento bloqueado: não monta um pedido que não poderia ser concluído', async () => {
    const attempts: LoginAttemptStore = { save: () => false, take: () => null };
    const provider = createCognitoProvider({ ...setup().config, attempts });
    await expectKind(provider.beginSignIn('sign-in', '/'), 'invalid-response');
  });
});

describe('descoberta OIDC', () => {
  it('parte só do emissor da configuração e usa fetch seguro', async () => {
    const s = setup();
    await s.provider.beginSignIn('sign-in', '/');
    expect(s.cognito.seen.discovery).toEqual([DISCOVERY_URL]);
    expect(s.calls.length).toBeGreaterThan(0);
    for (const init of s.calls) {
      expect([init.credentials, init.redirect]).toEqual(['omit', 'error']);
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it('tenta de novo depois de uma falha', async () => {
    const s = setup();
    let fail = true;
    server.use(
      http.get(DISCOVERY_URL, () =>
        fail ? new HttpResponse(null, { status: 503 }) : HttpResponse.json(BASE),
      ),
    );
    await expectKind(s.provider.beginSignIn('sign-in', '/'), 'network');
    fail = false;
    await expect(s.provider.beginSignIn('sign-in', '/')).resolves.toContain('/oauth2/authorize');
  });

  const EVIL = 'https://evil.example.net';
  it.each<[string, unknown]>([
    ['emissor diferente', { ...BASE, issuer: 'https://outro.example.com/p' }],
    ['autorização em outra origem', { ...BASE, authorization_endpoint: `${EVIL}/a` }],
    ['token em outra origem', { ...BASE, token_endpoint: `${EVIL}/t` }],
    ['revogação em outra origem', { ...BASE, revocation_endpoint: `${EVIL}/r` }],
    ['logout em outra origem', { ...BASE, end_session_endpoint: `${EVIL}/l` }],
    ['URL inválida', { ...BASE, token_endpoint: 'https://a b' }],
    ['endpoint http', { ...BASE, token_endpoint: 'http://auth.example.com/t' }],
    ['endpoint com query', { ...BASE, token_endpoint: `${TOKEN_URL}?x=1` }],
    ['sem S256', { ...BASE, code_challenge_methods_supported: ['plain'] }],
    ['sem endpoint de token', DOC],
    ['fora do formato', 'texto'],
  ])('recusa: %s', async (_name, discovery) => {
    const s = setup({ discovery: discovery as Body });
    await expectKind(s.provider.beginSignIn('sign-in', '/'), 'invalid-response');
    expect(s.storage.length).toBe(0);
  });

  it('aceita o emissor com barra no fim; falha de rede vira network', async () => {
    const s = setup({ discovery: { ...BASE, issuer: `${ISSUER}/` } });
    await expect(s.provider.beginSignIn('sign-in', '/')).resolves.toContain(AUTH_ORIGIN);
    const down = setup();
    server.use(http.get(DISCOVERY_URL, () => HttpResponse.error()));
    await expectKind(down.provider.beginSignIn('sign-in', '/'), 'network');
  });
});
