import type { AuthScreen, IdentityProvider, LoginAttemptStore } from '../application/ports';
import { AuthError } from '../model/authError';
import { discoveryUrl, parseEndpoints, type Endpoints } from '../model/endpoints';
import { buildSession, readIdentity, tokenResponseSchema } from '../model/tokens';
import { constantTimeEqual, pkceChallenge, randomToken } from './webCrypto';

export type CognitoProviderConfig = {
  /** Emissor do `/config.json` já validado: a única origem de onde a descoberta parte. */
  readonly authority: string;
  readonly clientId: string;
  /** `<origem>/auth/callback`, idêntico ao registrado no cliente do Cognito. */
  readonly redirectUri: string;
  /** `<origem>/`, idêntico ao registrado no cliente do Cognito. */
  readonly logoutUri: string;
  readonly attempts: LoginAttemptStore;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  /** Tempo limite de cada chamada, em milissegundos. Padrão: 10 s. */
  readonly timeoutMs?: number;
};

const SCOPE = 'openid email';
const ATTEMPT_TTL_MS = 10 * 60_000;
const CODE_PATTERN = /^[\w.~-]{1,2048}$/;
const STATE_PATTERN = /^[\w-]{1,128}$/;

type Reply = { readonly status: number; readonly body: unknown };

/** Login gerenciado do Cognito: Authorization Code + PKCE S256, só com `fetch` e Web Crypto. */
export function createCognitoProvider(config: CognitoProviderConfig): IdentityProvider {
  const { authority, clientId, redirectUri, logoutUri, attempts } = config;
  const now = config.now ?? Date.now;
  const timeoutMs = config.timeoutMs ?? 10_000;
  let endpoints: Promise<Endpoints> | undefined;

  /** Nunca segue redirecionamento, nunca envia nem aceita cookie, nunca usa cache. */
  async function call(url: string, init: RequestInit, limitMs = timeoutMs): Promise<Reply> {
    try {
      const response = await (config.fetch ?? fetch)(url, {
        ...init,
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        signal: AbortSignal.timeout(limitMs),
      });
      return { status: response.status, body: await response.json().catch(() => undefined) };
    } catch {
      throw new AuthError('network');
    }
  }

  function discover(): Promise<Endpoints> {
    endpoints ??= call(discoveryUrl(authority), { method: 'GET' })
      .then((reply) => {
        if (reply.status !== 200) throw new AuthError('network');
        return parseEndpoints(reply.body, authority);
      })
      .catch((error: unknown) => {
        endpoints = undefined;
        throw error;
      });
    return endpoints;
  }

  function postForm(url: string, fields: Record<string, string>, limitMs?: number) {
    return call(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(fields),
      },
      limitMs,
    );
  }

  return {
    async beginSignIn(screen: AuthScreen, returnTo) {
      const found = await discover();
      const state = randomToken(32);
      const nonce = randomToken(32);
      const verifier = randomToken(64);
      const saved = attempts.save({ state, verifier, nonce, returnTo, createdAt: now() });
      if (!saved) throw new AuthError('invalid-response');
      const base =
        screen === 'sign-in'
          ? found.signIn
          : screen === 'sign-up'
            ? found.signUp
            : found.forgotPassword;
      const url = new URL(base);
      url.search = new URLSearchParams({
        client_id: clientId,
        response_type: 'code',
        scope: SCOPE,
        redirect_uri: redirectUri,
        state,
        nonce,
        code_challenge: await pkceChallenge(verifier),
        code_challenge_method: 'S256',
      }).toString();
      return url.toString();
    },

    async completeSignIn(callbackUrl) {
      // Uso único: a tentativa é apagada antes de qualquer outra coisa, vença ou não.
      const attempt = attempts.take();
      let url: URL;
      try {
        url = new URL(callbackUrl);
      } catch {
        throw new AuthError('callback-invalid');
      }
      const expected = new URL(redirectUri);
      if (url.origin !== expected.origin || url.pathname !== expected.pathname) {
        throw new AuthError('callback-invalid');
      }
      const single = (name: string): string | null => {
        const values = url.searchParams.getAll(name);
        if (values.length > 1) throw new AuthError('callback-invalid');
        return values[0] ?? null;
      };
      const error = single('error');
      const code = single('code');
      const state = single('state');
      if (error !== null) throw new AuthError('provider-denied');
      if (code === null || state === null) throw new AuthError('callback-invalid');
      if (!CODE_PATTERN.test(code) || !STATE_PATTERN.test(state)) {
        throw new AuthError('callback-invalid');
      }
      if (
        attempt === null ||
        !constantTimeEqual(state, attempt.state) ||
        now() - attempt.createdAt > ATTEMPT_TTL_MS
      ) {
        throw new AuthError('state-mismatch');
      }

      const found = await discover();
      const reply = await postForm(found.token, {
        grant_type: 'authorization_code',
        client_id: clientId,
        code,
        redirect_uri: redirectUri,
        code_verifier: attempt.verifier,
      });
      if (reply.status >= 400 && reply.status < 500 && reply.status !== 429) {
        throw new AuthError('provider-denied');
      }
      if (reply.status !== 200) throw new AuthError('network');
      const tokens = tokenResponseSchema.safeParse(reply.body);
      if (!tokens.success || tokens.data.id_token === undefined) {
        throw new AuthError('invalid-response');
      }
      const nowMs = now();
      const user = readIdentity(
        tokens.data.id_token,
        { issuer: authority, clientId, nonce: attempt.nonce, nowMs },
        constantTimeEqual,
      );
      return {
        session: buildSession(user, tokens.data, null, nowMs),
        returnTo: attempt.returnTo,
      };
    },

    async refresh(session) {
      if (session.refreshToken === null) throw new AuthError('session-expired');
      const found = await discover();
      const reply = await postForm(found.token, {
        grant_type: 'refresh_token',
        client_id: clientId,
        refresh_token: session.refreshToken,
      });
      if (reply.status >= 400 && reply.status < 500 && reply.status !== 429) {
        throw new AuthError('session-expired');
      }
      if (reply.status !== 200) throw new AuthError('network');
      const tokens = tokenResponseSchema.safeParse(reply.body);
      if (!tokens.success) throw new AuthError('invalid-response');
      return buildSession(session.user, tokens.data, session.refreshToken, now());
    },

    async endSession(session) {
      try {
        const found = await discover();
        if (session?.refreshToken) {
          // Melhor esforço: a sessão local já foi apagada e o logout segue mesmo se falhar.
          await postForm(
            found.revoke,
            { token: session.refreshToken, client_id: clientId },
            5_000,
          ).catch(() => undefined);
        }
        const url = new URL(found.logout);
        url.search = new URLSearchParams({ client_id: clientId, logout_uri: logoutUri }).toString();
        return url.toString();
      } catch {
        return logoutUri;
      }
    },
  };
}
