import type { SessionStore } from '../application/ports';
import { sessionSchema, type Session } from '../model/session';

/**
 * Sessão só em memória: os tokens nunca vão para `localStorage`, `sessionStorage`, IndexedDB nem
 * cookie. Recarregar a página encerra a sessão local; entrar de novo é rápido porque o login
 * gerenciado do Cognito mantém o próprio cookie de sessão. Guarda uma cópia validada.
 */
export function createMemorySessionStore(): SessionStore {
  let current: Session | null = null;
  return {
    read() {
      if (current === null) return null;
      const parsed = sessionSchema.safeParse(current);
      if (parsed.success) return parsed.data;
      current = null;
      return null;
    },
    write(session) {
      const parsed = sessionSchema.safeParse(session);
      current = parsed.success ? parsed.data : null;
    },
    clear() {
      current = null;
    },
  };
}
