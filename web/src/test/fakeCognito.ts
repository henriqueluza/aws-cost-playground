import { http, HttpResponse, type HttpHandler } from 'msw';
import { pkceChallenge } from '../features/auth/infrastructure/webCrypto';

/** Servidor de autorização simulado (Cognito): confere PKCE, código de uso único e refresh token. */
export const ISSUER = 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_Teste';
export const AUTH_ORIGIN = 'https://auth.example.com';
export const CLIENT_ID = 'cliente-de-teste';
export const APP = 'https://app.example.com';
export const REDIRECT_URI = `${APP}/auth/callback`;
export const LOGOUT_URI = `${APP}/`;

function base64Url(value: unknown): string {
  return btoa(JSON.stringify(value)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

/** ID token sem assinatura válida (o cliente não a verifica). */
export function makeIdToken(claims: Record<string, unknown>): string {
  return `${base64Url({ alg: 'RS256' })}.${base64Url(claims)}.assinatura`;
}

export type FakeCognitoOptions = {
  discovery?: Record<string, unknown>;
  discoveryStatus?: number;
  /** Troca os claims do ID token emitido. */
  claims?: (nonce: string) => Record<string, unknown>;
  /** Troca o corpo da resposta de token (login). */
  tokenBody?: (body: Record<string, unknown>) => Record<string, unknown>;
  refreshStatus?: number;
  refreshBody?: Record<string, unknown>;
  revokeStatus?: number;
};

const denied = { error: 'invalid_grant', error_description: 'segredo-do-servidor' };

export function createFakeCognito(options: FakeCognitoOptions = {}) {
  const codes = new Map<string, { challenge: string; nonce: string; redirectUri: string }>();
  const refreshTokens = new Set<string>();
  const seen = { discovery: [] as string[], tokenBodies: [] as URLSearchParams[] };
  const revoked: URLSearchParams[] = [];
  let counter = 0;

  const discovery = options.discovery ?? {
    issuer: ISSUER,
    authorization_endpoint: `${AUTH_ORIGIN}/oauth2/authorize`,
    token_endpoint: `${AUTH_ORIGIN}/oauth2/token`,
    revocation_endpoint: `${AUTH_ORIGIN}/oauth2/revoke`,
    end_session_endpoint: `${AUTH_ORIGIN}/logout`,
    code_challenge_methods_supported: ['S256'],
  };

  const handlers: HttpHandler[] = [
    http.get(`${ISSUER}/.well-known/openid-configuration`, ({ request }) => {
      seen.discovery.push(request.url);
      return HttpResponse.json(discovery, { status: options.discoveryStatus ?? 200 });
    }),
    http.post(`${AUTH_ORIGIN}/oauth2/token`, async ({ request }) => {
      const body = new URLSearchParams(await request.text());
      seen.tokenBodies.push(body);
      const grant = body.get('grant_type');
      if (grant === 'refresh_token') {
        const token = body.get('refresh_token') ?? '';
        if (options.refreshStatus) {
          return HttpResponse.json(denied, { status: options.refreshStatus });
        }
        if (!refreshTokens.has(token) || body.get('client_id') !== CLIENT_ID) {
          return HttpResponse.json(denied, { status: 400 });
        }
        counter += 1;
        return HttpResponse.json(
          options.refreshBody ?? {
            access_token: `access-renovado-${counter}`,
            id_token: 'ignorado.ignorado.ignorado',
            token_type: 'Bearer',
            expires_in: 900,
          },
        );
      }
      const entry = codes.get(body.get('code') ?? '');
      codes.delete(body.get('code') ?? '');
      const verifier = body.get('code_verifier') ?? '';
      if (
        grant !== 'authorization_code' ||
        !entry ||
        body.has('client_secret') ||
        body.get('client_id') !== CLIENT_ID ||
        body.get('redirect_uri') !== entry.redirectUri ||
        (await pkceChallenge(verifier)) !== entry.challenge
      ) {
        return HttpResponse.json(denied, { status: 400 });
      }
      counter += 1;
      const refresh = `refresh-${counter}`;
      refreshTokens.add(refresh);
      const claims = options.claims?.(entry.nonce) ?? {
        iss: ISSUER,
        aud: CLIENT_ID,
        sub: 'sub-do-usuario',
        exp: Math.floor(Date.now() / 1000) + 900,
        nonce: entry.nonce,
        token_use: 'id',
        email: 'pessoa@example.com',
        email_verified: true,
      };
      const response = {
        access_token: `access-${counter}`,
        id_token: makeIdToken(claims),
        refresh_token: refresh,
        token_type: 'Bearer',
        expires_in: 900,
      };
      return HttpResponse.json(options.tokenBody ? options.tokenBody(response) : response);
    }),
    http.post(`${AUTH_ORIGIN}/oauth2/revoke`, async ({ request }) => {
      revoked.push(new URLSearchParams(await request.text()));
      return new HttpResponse(null, { status: options.revokeStatus ?? 200 });
    }),
  ];

  /** Faz o papel da tela de login: valida o pedido e devolve a URL de retorno com o `code`. */
  function authorize(authorizationUrl: string): string {
    const url = new URL(authorizationUrl);
    const p = url.searchParams;
    if (
      p.get('response_type') !== 'code' ||
      p.get('code_challenge_method') !== 'S256' ||
      p.get('client_id') !== CLIENT_ID
    ) {
      throw new Error('pedido de autorização inválido');
    }
    counter += 1;
    const code = `codigo-${counter}`;
    codes.set(code, {
      challenge: p.get('code_challenge') ?? '',
      nonce: p.get('nonce') ?? '',
      redirectUri: p.get('redirect_uri') ?? '',
    });
    return `${p.get('redirect_uri')}?code=${code}&state=${p.get('state')}`;
  }

  return { handlers, authorize, seen, revoked, refreshTokens, codes };
}
