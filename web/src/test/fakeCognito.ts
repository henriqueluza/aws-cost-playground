import { http, HttpResponse, type HttpHandler } from 'msw';

/** Servidor de autorização simulado (Cognito). */
export const ISSUER = 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_Teste';
export const AUTH_ORIGIN = 'https://auth.example.com';
export const CLIENT_ID = 'cliente-de-teste';
export const REDIRECT_URI = 'https://app.example.com/auth/callback';
export const TOKEN_URL = `${AUTH_ORIGIN}/oauth2/token`;
export const DISCOVERY_URL = `${ISSUER}/.well-known/openid-configuration`;

export type FakeCognitoOptions = {
  discovery?: Record<string, unknown>;
  discoveryStatus?: number;
};

export function createFakeCognito(options: FakeCognitoOptions = {}) {
  const seen = { discovery: [] as string[] };
  const discovery = options.discovery ?? {
    issuer: ISSUER,
    authorization_endpoint: `${AUTH_ORIGIN}/oauth2/authorize`,
    token_endpoint: TOKEN_URL,
    code_challenge_methods_supported: ['S256'],
  };
  const handlers: HttpHandler[] = [
    http.get(DISCOVERY_URL, ({ request }) => {
      seen.discovery.push(request.url);
      return HttpResponse.json(discovery, { status: options.discoveryStatus ?? 200 });
    }),
  ];
  return { handlers, seen };
}
