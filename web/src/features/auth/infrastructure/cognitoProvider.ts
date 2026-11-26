import type { AuthScreen, IdentityProvider, LoginAttemptStore } from '../application/ports';
import { AuthError } from '../model/authError';
import { discoveryUrl, parseEndpoints, type Endpoints } from '../model/endpoints';
import { pkceChallenge, randomToken } from './webCrypto';

export type CognitoProviderConfig = {
  /** Emissor do `/config.json` já validado: a única origem de onde a descoberta parte. */
  readonly authority: string;
  readonly clientId: string;
  /** `<origem>/auth/callback`, idêntico ao registrado no cliente do Cognito. */
  readonly redirectUri: string;
  readonly attempts: LoginAttemptStore;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  /** Tempo limite de cada chamada, em milissegundos. Padrão: 10 s. */
  readonly timeoutMs?: number;
};

const SCOPE = 'openid email';

type Reply = { readonly status: number; readonly body: unknown };

/** A parte do provedor que leva ao login; retorno, renovação e logout vêm em #286. */
export type CognitoLoginProvider = Pick<IdentityProvider, 'beginSignIn'>;

/** Login gerenciado do Cognito: Authorization Code + PKCE S256, só com `fetch` e Web Crypto. */
export function createCognitoProvider(config: CognitoProviderConfig): CognitoLoginProvider {
  const { authority, clientId, redirectUri, attempts } = config;
  const now = config.now ?? Date.now;
  const timeoutMs = config.timeoutMs ?? 10_000;
  let endpoints: Promise<Endpoints> | undefined;

  /** Nunca segue redirecionamento, nunca envia nem aceita cookie, nunca usa cache. */
  async function call(url: string, init: RequestInit): Promise<Reply> {
    try {
      const response = await (config.fetch ?? fetch)(url, {
        ...init,
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        signal: AbortSignal.timeout(timeoutMs),
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
  };
}
