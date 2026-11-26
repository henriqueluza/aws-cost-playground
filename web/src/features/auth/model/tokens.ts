import { z } from 'zod';
import { AuthError } from './authError';
import { sessionSchema, type Session } from './session';

/** Resposta do endpoint de token, validada antes de qualquer uso. */
export const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  id_token: z.string().min(1).optional(),
  refresh_token: z.string().min(1).optional(),
  token_type: z.string().regex(/^bearer$/i),
  expires_in: z.number().int().min(1).max(86_400),
});
export type TokenResponse = z.infer<typeof tokenResponseSchema>;

/** Claims do ID token. Só `sub` e `email` verificado saem daqui. */
const idClaimsSchema = z.object({
  iss: z.string(),
  aud: z.union([z.string(), z.array(z.string())]),
  sub: z.string(),
  exp: z.number(),
  nonce: z.string().optional(),
  token_use: z.string().optional(),
  email: z.string().optional(),
  email_verified: z.union([z.boolean(), z.enum(['true', 'false'])]).optional(),
});

function decodePayload(jwt: string): unknown {
  const parts = jwt.split('.');
  const payload = parts[1];
  if (parts.length !== 3 || !payload || !/^[\w-]+$/.test(payload)) return undefined;
  try {
    const base64 = payload.replaceAll('-', '+').replaceAll('_', '/');
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return undefined;
  }
}

export type IdentityCheck = {
  readonly issuer: string;
  readonly clientId: string;
  readonly nonce: string;
  readonly nowMs: number;
};

/**
 * Lê o ID token que chegou direto do endpoint de token (TLS, sem intermediário) e confere `iss`,
 * `aud`, `nonce` e `exp`. A assinatura não é verificada de propósito: o cliente não decide
 * autorização com JWT, só lê `sub` e o e-mail verificado para a interface; quem autoriza é o
 * API Gateway.
 */
export function readIdentity(
  idToken: string,
  check: IdentityCheck,
  equal: (a: string, b: string) => boolean,
): Session['user'] {
  const parsed = idClaimsSchema.safeParse(decodePayload(idToken));
  if (!parsed.success) throw new AuthError('invalid-response');
  const claims = parsed.data;
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  const valid =
    equal(claims.iss.replace(/\/+$/, ''), check.issuer.replace(/\/+$/, '')) &&
    audiences.includes(check.clientId) &&
    claims.nonce !== undefined &&
    equal(claims.nonce, check.nonce) &&
    (claims.token_use === undefined || claims.token_use === 'id') &&
    claims.exp * 1000 > check.nowMs;
  if (!valid) throw new AuthError('invalid-response');
  const verified = claims.email_verified === true || claims.email_verified === 'true';
  return { sub: claims.sub, email: verified && claims.email ? claims.email : null };
}

/** Monta a sessão; qualquer campo fora do schema vira `invalid-response`. */
export function buildSession(
  user: Session['user'],
  tokens: TokenResponse,
  fallbackRefresh: string | null,
  nowMs: number,
): Session {
  const parsed = sessionSchema.safeParse({
    user,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? fallbackRefresh,
    expiresAt: nowMs + tokens.expires_in * 1000,
  });
  if (!parsed.success) throw new AuthError('invalid-response');
  return parsed.data;
}
