import { z } from 'zod';
import { AuthError } from './authError';

/** URL absoluta `https` sem credenciais, query nem fragmento. */
const endpointUrl = z.url({ protocol: /^https$/ }).refine((value) => {
  try {
    const url = new URL(value);
    return !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
});

/** Documento de descoberta OIDC (só o que se usa; campos a mais são ignorados). */
const discoverySchema = z.object({
  issuer: z.string().min(1).max(512),
  authorization_endpoint: endpointUrl,
  token_endpoint: endpointUrl,
  revocation_endpoint: endpointUrl.optional(),
  end_session_endpoint: endpointUrl.optional(),
  code_challenge_methods_supported: z.array(z.string()).optional(),
});

/** Endpoints do servidor de autorização, todos `https` e da mesma origem. */
export type Endpoints = {
  readonly signIn: string;
  readonly signUp: string;
  readonly forgotPassword: string;
  readonly token: string;
  readonly revoke: string;
  readonly logout: string;
};

const withoutTrailingSlash = (value: string) => value.replace(/\/+$/, '');

/** Caminho de descoberta, resolvido a partir do emissor do `/config.json` (nunca de uma query). */
export function discoveryUrl(authority: string): string {
  return `${withoutTrailingSlash(authority)}/.well-known/openid-configuration`;
}

/**
 * Valida o documento de descoberta contra o emissor esperado e devolve os endpoints. O `issuer` do
 * documento tem de ser o emissor da configuração e todo endpoint tem de ser `https` e da mesma
 * origem do endpoint de autorização: um documento que aponte outra origem é recusado. O Cognito
 * pode não listar revogação e logout; nesse caso saem da origem validada (`/oauth2/revoke`,
 * `/logout`), assim como as telas `/signup` e `/forgotPassword` do login gerenciado.
 */
export function parseEndpoints(raw: unknown, authority: string): Endpoints {
  const parsed = discoverySchema.safeParse(raw);
  if (!parsed.success) throw new AuthError('invalid-response');
  const doc = parsed.data;
  if (withoutTrailingSlash(doc.issuer) !== withoutTrailingSlash(authority)) {
    throw new AuthError('invalid-response');
  }
  const methods = doc.code_challenge_methods_supported;
  if (methods && !methods.includes('S256')) throw new AuthError('invalid-response');
  const origin = new URL(doc.authorization_endpoint).origin;
  const listed = [doc.token_endpoint, doc.revocation_endpoint, doc.end_session_endpoint];
  if (listed.some((value) => value !== undefined && new URL(value).origin !== origin)) {
    throw new AuthError('invalid-response');
  }
  return {
    signIn: doc.authorization_endpoint,
    signUp: `${origin}/signup`,
    forgotPassword: `${origin}/forgotPassword`,
    token: doc.token_endpoint,
    revoke: doc.revocation_endpoint ?? `${origin}/oauth2/revoke`,
    logout: doc.end_session_endpoint ?? `${origin}/logout`,
  };
}
