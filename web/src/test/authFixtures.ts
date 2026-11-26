import type { Session } from '../features/auth';

/** Instante fixo dos testes de sessão (2026-11-25T12:00:00Z), em milissegundos desde a época. */
export const NOW = 1_795_608_000_000;

/**
 * Sessão válida em `NOW`, com tokens de mentira (fora do formato de JWT, de propósito).
 * `overrides` troca campos da raiz.
 */
export function fakeSession(overrides: Partial<Session> = {}): Session {
  return {
    user: { sub: 'usuario-de-teste', email: 'pessoa@example.com' },
    accessToken: 'access-token-de-teste',
    refreshToken: 'refresh-token-de-teste',
    expiresAt: NOW + 15 * 60_000,
    ...overrides,
  };
}
