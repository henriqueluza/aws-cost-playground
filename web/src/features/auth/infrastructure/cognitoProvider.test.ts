// @vitest-environment node
import { delay, http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { NOW, fakeSession } from '../../../test/authFixtures';
import {
  APP,
  AUTH_ORIGIN,
  CLIENT_ID,
  createFakeCognito,
  ISSUER,
  LOGOUT_URI,
  REDIRECT_URI,
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

const ATTEMPT_KEY = 'aws-cost-playground:login-attempt';
const TOKEN_URL = `${AUTH_ORIGIN}/oauth2/token`;
const DISCOVERY_URL = `${ISSUER}/.well-known/openid-configuration`;
const SITE = { siteOrigin: APP };

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, value),
  };
}

function setup(options: FakeCognitoOptions = {}) {
  const cognito = createFakeCognito(options);
  server.use(...cognito.handlers);
  const storage = memoryStorage();
  const attempts = createSessionAttemptStore(storage);
  const clock = { now: NOW };
  const calls: { url: string; init: RequestInit }[] = [];
  const spyFetch: typeof fetch = (input, init) => {
    calls.push({ url: String(input), init: init ?? {} });
    return fetch(input, init);
  };
  const provider = createCognitoProvider({
    authority: ISSUER,
    clientId: CLIENT_ID,
    redirectUri: REDIRECT_URI,
    logoutUri: LOGOUT_URI,
    site: SITE,
    attempts,
    fetch: spyFetch,
    now: () => clock.now,
  });
  return { cognito, storage, attempts, calls, provider, clock };
}
type Setup = ReturnType<typeof setup>;

async function rejection(promise: Promise<unknown>): Promise<AuthError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AuthError);
  return error as AuthError;
}

async function expectKind(promise: Promise<unknown>, kind: AuthErrorKind) {
  expect((await rejection(promise)).kind).toBe(kind);
}

async function login(s: Setup) {
  const url = await s.provider.beginSignIn('sign-in', '/designs?x=1');
  return { url, callback: s.cognito.authorize(url) };
}

function savedAttempt(s: Setup): LoginAttempt {
  return JSON.parse(s.storage.getItem(ATTEMPT_KEY) ?? '{}') as LoginAttempt;
}

describe('beginSignIn', () => {
  it('monta o pedido de código com PKCE S256, escopo exato e tentativa de uso único', async () => {
    const s = setup();
    const url = new URL(await s.provider.beginSignIn('sign-in', '/designs'));
    expect(`${url.origin}${url.pathname}`).toBe(`${AUTH_ORIGIN}/oauth2/authorize`);
    const p = url.searchParams;
    expect(p.get('response_type')).toBe('code');
    expect(p.get('scope')).toBe('openid email');
    expect(p.get('client_id')).toBe(CLIENT_ID);
    expect(p.get('redirect_uri')).toBe(REDIRECT_URI);
    expect(p.get('code_challenge_method')).toBe('S256');
    expect(p.get('code_challenge')).toMatch(/^[\w-]{43}$/);
    expect(p.get('state')).toMatch(/^[\w-]{43}$/);
    expect(p.get('nonce')).toMatch(/^[\w-]{43}$/);
    expect(p.has('client_secret')).toBe(false);
    expect(url.hash).toBe('');
    const saved = s.attempts.take();
    expect(saved?.verifier).toHaveLength(86);
    expect(url.toString()).not.toContain(saved?.verifier ?? '?');
    expect(saved?.state).toBe(p.get('state'));
    expect(saved?.createdAt).toBe(NOW);
    expect(Object.keys(saved ?? {}).sort()).toEqual([
      'createdAt',
      'nonce',
      'returnTo',
      'state',
      'verifier',
    ]);
  });

  it.each([
    ['sign-up', '/signup'],
    ['forgot-password', '/forgotPassword'],
  ] as const)('a tela %s fica na mesma origem validada', async (screen, path) => {
    const s = setup();
    const url = new URL(await s.provider.beginSignIn(screen, '/'));
    expect(url.origin).toBe(AUTH_ORIGIN);
    expect(url.pathname).toBe(path);
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
    const s = setup();
    const blocked: LoginAttemptStore = { save: () => false, take: () => null };
    const provider = createCognitoProvider({
      authority: ISSUER,
      clientId: CLIENT_ID,
      redirectUri: REDIRECT_URI,
      logoutUri: LOGOUT_URI,
      site: SITE,
      attempts: blocked,
    });
    await expectKind(provider.beginSignIn('sign-in', '/'), 'invalid-response');
    expect(s.storage.length).toBe(0);
  });
});

describe('descoberta OIDC', () => {
  const base = {
    issuer: ISSUER,
    authorization_endpoint: `${AUTH_ORIGIN}/oauth2/authorize`,
    token_endpoint: TOKEN_URL,
  };

  it('parte só do emissor da configuração e usa fetch seguro', async () => {
    const s = setup();
    await login(s);
    expect(s.cognito.seen.discovery).toEqual([DISCOVERY_URL]);
    expect(s.calls.length).toBeGreaterThan(0);
    for (const { init } of s.calls) {
      expect(init.credentials).toBe('omit');
      expect(init.redirect).toBe('error');
      expect([init.cache, init.referrerPolicy]).toEqual(['no-store', 'no-referrer']);
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it('descobre uma vez e tenta de novo depois de uma falha', async () => {
    const s = setup();
    let fail = true;
    server.use(
      http.get(DISCOVERY_URL, () =>
        fail ? new HttpResponse(null, { status: 503 }) : HttpResponse.json(base),
      ),
    );
    await expectKind(s.provider.beginSignIn('sign-in', '/'), 'network');
    fail = false;
    await expect(s.provider.beginSignIn('sign-in', '/')).resolves.toContain('/oauth2/authorize');
  });

  it.each([
    ['emissor diferente', { ...base, issuer: 'https://outro.example.com/pool' }],
    ['token em outra origem', { ...base, token_endpoint: 'https://evil.example.net/t' }],
    ['revogação fora da origem', { ...base, revocation_endpoint: 'https://evil.example.net/r' }],
    ['URL inválida', { ...base, token_endpoint: 'https://a b' }],
    ['endpoint http', { ...base, token_endpoint: TOKEN_URL.replace('https:', 'http:') }],
    ['endpoint com query', { ...base, token_endpoint: `${TOKEN_URL}?x=1` }],
    ['sem S256', { ...base, code_challenge_methods_supported: ['plain'] }],
    ['logout fora da origem', { ...base, end_session_endpoint: 'https://evil.example.net/l' }],
    ['fora do formato', 'texto'],
  ])('recusa: %s', async (_name, doc) => {
    const s = setup({ discovery: doc as Record<string, unknown> });
    await expectKind(s.provider.beginSignIn('sign-in', '/'), 'invalid-response');
    expect(s.storage.length).toBe(0);
  });

  it('todos os endpoints em outro domínio, coerentes entre si: recusa sem guardar tentativa', async () => {
    const other = 'https://auth.atacante.example.net';
    const doc = {
      issuer: ISSUER,
      authorization_endpoint: `${other}/oauth2/authorize`,
      token_endpoint: `${other}/oauth2/token`,
      revocation_endpoint: `${other}/oauth2/revoke`,
      end_session_endpoint: `${other}/logout`,
      code_challenge_methods_supported: ['S256'],
    };
    const s = setup({ discovery: doc });
    for (const screen of ['sign-in', 'sign-up', 'forgot-password'] as const) {
      await expectKind(s.provider.beginSignIn(screen, '/'), 'login-origin');
    }
    expect(s.storage.length).toBe(0);
    // Sem origem validada não há para onde revogar nem sair: o logout volta ao próprio site.
    await expect(s.provider.endSession(fakeSession())).resolves.toBe(LOGOUT_URI);
    expect(s.calls.every(({ url }) => url === DISCOVERY_URL)).toBe(true);
  });

  it.each([
    ['só a autorização em outra origem', 'https://evil.example.net/oauth2/authorize'],
    ['o próprio site no lugar do login', `${APP}/oauth2/authorize`],
    ['domínio irmão do site', 'https://auth.example.com/oauth2/authorize'],
    ['porta fora do padrão', `${AUTH_ORIGIN}:8443/oauth2/authorize`],
  ])('recusa o login que não é o deste site: %s', async (_name, authorization) => {
    const s = setup({ discovery: { ...base, authorization_endpoint: authorization } });
    await expectKind(s.provider.beginSignIn('sign-in', '/'), 'login-origin');
    expect(s.storage.length).toBe(0);
  });

  it('aceita o emissor com barra no fim e deriva o logout da origem validada', async () => {
    const s = setup({ discovery: { ...base, issuer: `${ISSUER}/` } });
    const url = new URL(await s.provider.endSession(fakeSession()));
    expect(`${url.origin}${url.pathname}`).toBe(`${AUTH_ORIGIN}/logout`);
  });

  it('falha de rede vira network', async () => {
    const s = setup();
    server.use(http.get(DISCOVERY_URL, () => HttpResponse.error()));
    await expectKind(s.provider.beginSignIn('sign-in', '/'), 'network');
  });
});

describe('completeSignIn', () => {
  it('troca o código com PKCE de verdade e devolve só sub e e-mail verificado', async () => {
    const s = setup();
    const { callback } = await login(s);
    const result = await s.provider.completeSignIn(callback);
    expect(result.returnTo).toBe('/designs?x=1');
    expect(result.session).toEqual({
      user: { sub: 'sub-do-usuario', email: 'pessoa@example.com' },
      accessToken: expect.stringMatching(/^access-/) as string,
      refreshToken: expect.stringMatching(/^refresh-/) as string,
      expiresAt: NOW + 900_000,
    });
    const body = s.cognito.seen.tokenBodies[0] as URLSearchParams;
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code_verifier')).toHaveLength(86);
    expect(body.has('client_secret')).toBe(false);
    const post = s.calls.find((c) => c.url === TOKEN_URL);
    expect(post?.init.credentials).toBe('omit');
    expect(post?.init.redirect).toBe('error');
    expect(s.storage.length).toBe(0);
  });

  it('apaga a tentativa antes da troca', async () => {
    const s = setup();
    const { callback } = await login(s);
    let during = -1;
    server.use(
      http.post(TOKEN_URL, () => {
        during = s.storage.length;
        return HttpResponse.json({ error_description: 'segredo-do-servidor' }, { status: 400 });
      }),
    );
    const error = await rejection(s.provider.completeSignIn(callback));
    expect(error.kind).toBe('provider-denied');
    expect(error.message).not.toContain('segredo-do-servidor');
    expect(during).toBe(0);
  });

  it('o mesmo retorno só vale uma vez', async () => {
    const s = setup();
    const { callback } = await login(s);
    await s.provider.completeSignIn(callback);
    await expectKind(s.provider.completeSignIn(callback), 'state-mismatch');
  });

  it('e-mail não verificado não entra na sessão', async () => {
    const s = setup({
      claims: (n) => ({ ...sound(n), email: 'pessoa@example.com', email_verified: false }),
    });
    const { callback } = await login(s);
    const { session } = await s.provider.completeSignIn(callback);
    expect(session.user.email).toBeNull();
  });

  const BAD_RETURNS: [string, (state: string) => string, AuthErrorKind][] = [
    ['sem state', () => `${REDIRECT_URI}?code=abc`, 'callback-invalid'],
    ['sem code', (state) => `${REDIRECT_URI}?state=${state}`, 'callback-invalid'],
    [
      'com error',
      (state) =>
        `${REDIRECT_URI}?error=access_denied&error_description=Texto+do+servidor&state=${state}`,
      'provider-denied',
    ],
    ['com error e sem state', () => `${REDIRECT_URI}?error=access_denied`, 'provider-denied'],
    [
      'com state de outra tentativa',
      () => `${REDIRECT_URI}?code=abc&state=${'z'.repeat(43)}`,
      'state-mismatch',
    ],
    [
      'com code repetido',
      (state) => `${REDIRECT_URI}?code=a&code=b&state=${state}`,
      'callback-invalid',
    ],
    [
      'com state repetido',
      (state) => `${REDIRECT_URI}?code=a&state=${state}&state=${state}`,
      'callback-invalid',
    ],
    [
      'de outra origem',
      (state) => `https://evil.example.net/auth/callback?code=abc&state=${state}`,
      'callback-invalid',
    ],
    ['de outro caminho', (state) => `${APP}/outro?code=abc&state=${state}`, 'callback-invalid'],
    [
      'com code fora do alfabeto',
      (state) => `${REDIRECT_URI}?code=a%20b%3Cx&state=${state}`,
      'callback-invalid',
    ],
    ['que não é URL', () => 'isto não é url', 'callback-invalid'],
  ];

  it.each(BAD_RETURNS)(
    'recusa o retorno %s sem chamar o endpoint de token',
    async (_n, make, kind) => {
      const s = setup();
      await login(s);
      const error = await rejection(s.provider.completeSignIn(make(savedAttempt(s).state)));
      expect(error.kind).toBe(kind);
      expect(error.message).not.toContain('servidor');
      expect(error.cause).toBeUndefined();
      expect(s.cognito.seen.tokenBodies).toHaveLength(0);
      // Mesmo recusado, o retorno consumiu a tentativa.
      expect(s.storage.length).toBe(0);
    },
  );

  it('recusa sem tentativa pendente', async () => {
    const s = setup();
    await expectKind(
      s.provider.completeSignIn(`${REDIRECT_URI}?code=abc&state=${'a'.repeat(43)}`),
      'state-mismatch',
    );
    expect(s.cognito.seen.tokenBodies).toHaveLength(0);
  });

  it('recusa tentativa vencida (10 minutos)', async () => {
    const s = setup();
    const { callback } = await login(s);
    s.clock.now += 10 * 60_000 + 1;
    await expectKind(s.provider.completeSignIn(callback), 'state-mismatch');
  });

  it('código de outra tentativa: o servidor recusa pelo PKCE', async () => {
    const s = setup();
    const first = await login(s);
    const second = await login(s);
    const code = new URL(first.callback).searchParams.get('code');
    const state = new URL(second.callback).searchParams.get('state');
    await expectKind(
      s.provider.completeSignIn(`${REDIRECT_URI}?code=${code}&state=${state}`),
      'provider-denied',
    );
  });

  it.each([503, 429])('status %i no endpoint de token: network', async (status) => {
    const s = setup();
    const { callback } = await login(s);
    server.use(http.post(TOKEN_URL, () => new HttpResponse(null, { status })));
    await expectKind(s.provider.completeSignIn(callback), 'network');
  });

  it('estoura o tempo limite da troca: network', async () => {
    const s = setup();
    const { callback } = await login(s);
    const config = { authority: ISSUER, clientId: CLIENT_ID, redirectUri: REDIRECT_URI };
    const slow = createCognitoProvider({
      ...config,
      logoutUri: LOGOUT_URI,
      site: SITE,
      attempts: s.attempts,
      now: () => NOW,
      timeoutMs: 100,
    });
    server.use(http.post(TOKEN_URL, async () => (await delay(1_000), HttpResponse.json({}))));
    await expectKind(slow.completeSignIn(callback), 'network');
  });

  it('falha de rede no endpoint de token', async () => {
    const s = setup();
    const { callback } = await login(s);
    server.use(http.post(TOKEN_URL, () => HttpResponse.error()));
    await expectKind(s.provider.completeSignIn(callback), 'network');
  });

  const sound = (nonce: string) => ({
    iss: ISSUER,
    aud: CLIENT_ID,
    sub: 'sub-do-usuario',
    exp: Math.floor(Date.now() / 1000) + 900,
    nonce,
  });
  it.each([
    ['iss diferente', (n: string) => ({ ...sound(n), iss: 'https://evil.example.net' })],
    ['aud diferente', (n: string) => ({ ...sound(n), aud: 'outro-cliente' })],
    ['nonce diferente', (n: string) => ({ ...sound(n), nonce: `${n}x` })],
    ['sem nonce', (n: string) => ({ ...sound(n), nonce: undefined })],
    ['vencido', (n: string) => ({ ...sound(n), exp: 1 })],
  ])('ID token com %s é recusado', async (_n, claims) => {
    const s = setup({ claims });
    const { callback } = await login(s);
    await expectKind(s.provider.completeSignIn(callback), 'invalid-response');
  });

  type Body = Record<string, unknown>;
  it.each([
    ['sem id_token', (b: Body) => ({ ...b, id_token: undefined })],
    ['id_token que não é JWT', (b: Body) => ({ ...b, id_token: 'abc' })],
    ['expires_in texto', (b: Body) => ({ ...b, expires_in: '900' })],
    ['token_type errado', (b: Body) => ({ ...b, token_type: 'MAC' })],
  ])('resposta de token %s é recusada pelo schema', async (_n, tokenBody) => {
    const s = setup({ tokenBody });
    const { callback } = await login(s);
    await expectKind(s.provider.completeSignIn(callback), 'invalid-response');
  });
});

describe('refresh', () => {
  async function started(options?: FakeCognitoOptions) {
    const s = setup(options);
    const { callback } = await login(s);
    const { session } = await s.provider.completeSignIn(callback);
    return { s, session };
  }

  it('renova o access token e mantém o refresh token e o usuário', async () => {
    const { s, session } = await started();
    const renewed = await s.provider.refresh(session);
    expect(renewed.accessToken).not.toBe(session.accessToken);
    expect(renewed.refreshToken).toBe(session.refreshToken);
    expect(renewed.user).toEqual(session.user);
    const body = s.cognito.seen.tokenBodies.at(-1) as URLSearchParams;
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.has('client_secret')).toBe(false);
  });

  it.each([
    [400, 'session-expired'],
    [401, 'session-expired'],
    [500, 'network'],
    [429, 'network'],
  ] as const)('status %i do servidor: %s, sem repetir o texto dele', async (status, kind) => {
    const { s, session } = await started({ refreshStatus: status });
    const error = await rejection(s.provider.refresh(session));
    expect(error.kind).toBe(kind);
    expect(error.message).not.toContain('segredo');
  });

  it('refresh token desconhecido: session-expired', async () => {
    const { s, session } = await started();
    const stale = { ...session, refreshToken: 'revogado' };
    await expectKind(s.provider.refresh(stale), 'session-expired');
    await expectKind(s.provider.refresh({ ...session, refreshToken: null }), 'session-expired');
  });

  it('resposta fora do schema: invalid-response', async () => {
    const { s, session } = await started({
      refreshBody: { access_token: 'a b', token_type: 'Bearer', expires_in: 60 },
    });
    s.cognito.refreshTokens.add(session.refreshToken as string);
    await expectKind(s.provider.refresh(session), 'invalid-response');
  });
});

describe('endSession', () => {
  it('revoga o refresh token e devolve o logout com o logout_uri registrado', async () => {
    const s = setup();
    const session = fakeSession();
    const url = new URL(await s.provider.endSession(session));
    expect(`${url.origin}${url.pathname}`).toBe(`${AUTH_ORIGIN}/logout`);
    expect(url.searchParams.get('logout_uri')).toBe(LOGOUT_URI);
    expect(url.searchParams.get('client_id')).toBe(CLIENT_ID);
    const [revoked] = s.cognito.revoked;
    expect(s.cognito.revoked).toHaveLength(1);
    expect(revoked?.get('token')).toBe(session.refreshToken);
    expect(revoked?.get('client_id')).toBe(CLIENT_ID);
    expect(revoked?.has('client_secret')).toBe(false);
  });

  it('sem sessão ou sem refresh token não revoga nada', async () => {
    const s = setup();
    await s.provider.endSession(null);
    await s.provider.endSession(fakeSession({ refreshToken: null }));
    expect(s.cognito.revoked).toHaveLength(0);
  });

  it('falha na revogação não impede o logout', async () => {
    const s = setup({ revokeStatus: 500 });
    await expect(s.provider.endSession(fakeSession())).resolves.toContain('/logout?');
    server.use(http.post(`${AUTH_ORIGIN}/oauth2/revoke`, () => HttpResponse.error()));
    await expect(s.provider.endSession(fakeSession())).resolves.toContain('/logout?');
  });

  it('sem descoberta, volta para a própria URL do site e nunca rejeita', async () => {
    const s = setup({ discoveryStatus: 500 });
    await expect(s.provider.endSession(fakeSession())).resolves.toBe(LOGOUT_URI);
  });
});
