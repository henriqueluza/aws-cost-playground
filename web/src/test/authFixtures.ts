import { vi } from 'vitest';
import type { AuthService, AuthSnapshot, Session } from '../features/auth';

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

/**
 * Serviço de sessão falso, com o snapshot trocável (`set`) e as chamadas espiáveis. O cadastro
 * começa fechado, como no `/config.json` sem `selfSignupEnabled`.
 */
export function fakeAuth(
  initial: AuthSnapshot = { status: 'anonymous' },
  { signUpAvailable = false }: { signUpAvailable?: boolean } = {},
) {
  let snapshot = initial;
  const listeners = new Set<() => void>();
  const service = {
    signUpAvailable,
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    signIn: vi.fn<AuthService['signIn']>(() => Promise.resolve()),
    completeSignIn: vi.fn<AuthService['completeSignIn']>(() => Promise.resolve('/')),
    signOut: vi.fn<AuthService['signOut']>(() => Promise.resolve()),
    getAccessToken: vi.fn<AuthService['getAccessToken']>(() => Promise.resolve(null)),
  } satisfies AuthService;
  return {
    service,
    set(next: AuthSnapshot) {
      snapshot = next;
      for (const listener of [...listeners]) listener();
    },
  };
}
