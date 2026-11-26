import { z } from 'zod';

/**
 * Token como vai em `Authorization`: o mesmo alfabeto que o transporte HTTP aceita (JWT e base64),
 * sem espaço nem quebra de linha.
 */
const tokenSchema = z
  .string()
  .min(1)
  .max(8192)
  .regex(/^[\w.~+/=-]+$/);

/**
 * Quem está logado, só para a interface mostrar. A API nunca recebe estes campos: no servidor a
 * identidade vem do claim `sub` do JWT.
 */
export const authUserSchema = z.strictObject({
  sub: z.string().regex(/^[\w-]{1,128}$/),
  email: z.email().max(254).nullable(),
});

/**
 * Sessão do usuário. Fica só em memória e no `sessionStorage` da aba (nunca em `localStorage` nem
 * em cookie). O ID token não é guardado: dele só saem `sub` e `email`.
 */
export const sessionSchema = z.strictObject({
  user: authUserSchema,
  accessToken: tokenSchema,
  /** `null` quando o provedor não entregou refresh token: a sessão acaba com o access token. */
  refreshToken: tokenSchema.nullable(),
  /** Vencimento do access token, em milissegundos desde a época. */
  expiresAt: z.number().int().positive(),
});

export type AuthUser = z.infer<typeof authUserSchema>;
export type Session = z.infer<typeof sessionSchema>;

/** Folga antes do vencimento: um token a menos de um minuto de vencer já é tratado como vencido. */
export const EXPIRY_SKEW_MS = 60_000;

/** `true` se o access token ainda vale em `now` (milissegundos desde a época), com a folga. */
export function isFresh(session: Session, now: number): boolean {
  return session.expiresAt - EXPIRY_SKEW_MS > now;
}
