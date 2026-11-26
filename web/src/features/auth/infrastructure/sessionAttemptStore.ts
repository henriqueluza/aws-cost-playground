import { z } from 'zod';
import type { LoginAttempt, LoginAttemptStore } from '../application/ports';

const KEY = 'aws-cost-playground:login-attempt';

const attemptSchema = z.strictObject({
  state: z.string().regex(/^[\w-]{20,128}$/),
  verifier: z.string().regex(/^[\w-]{43,128}$/),
  nonce: z.string().regex(/^[\w-]{20,128}$/),
  returnTo: z.string().max(512),
  createdAt: z.number().int().positive(),
});

/**
 * Tentativa de login em andamento na aba (`sessionStorage`), sem nenhum token: só `state`,
 * `code_verifier`, `nonce` e o destino. De uso único (`take` apaga) e uma por aba: um novo pedido
 * substitui o anterior. Armazenamento indisponível ou corrompido nunca lança.
 */
export function createSessionAttemptStore(storage?: Storage): LoginAttemptStore {
  const area = (): Storage | null => {
    try {
      return storage ?? globalThis.sessionStorage;
    } catch {
      return null;
    }
  };
  return {
    save(attempt: LoginAttempt) {
      try {
        area()?.setItem(KEY, JSON.stringify(attempt));
        return area()?.getItem(KEY) !== null;
      } catch {
        return false;
      }
    },
    take() {
      let raw: string | null;
      try {
        const where = area();
        raw = where?.getItem(KEY) ?? null;
        where?.removeItem(KEY);
      } catch {
        return null;
      }
      if (raw === null) return null;
      try {
        const parsed = attemptSchema.safeParse(JSON.parse(raw));
        return parsed.success ? parsed.data : null;
      } catch {
        return null;
      }
    },
  };
}
