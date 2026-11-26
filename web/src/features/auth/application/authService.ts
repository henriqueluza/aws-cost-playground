import { AuthError } from '../model/authError';
import { isFresh, type Session } from '../model/session';
import { safeReturnTo } from '../model/returnTo';
import type { AuthService, AuthServiceDeps, AuthSnapshot, SignInOptions } from './ports';

const ANONYMOUS: AuthSnapshot = { status: 'anonymous' };

/** Sessão do usuário: guarda o estado, renova o access token (uma renovação por vez) e sai. */
export function createAuthService(deps: AuthServiceDeps): AuthService {
  const { provider, store, navigate } = deps;
  const now = deps.now ?? Date.now;
  const listeners = new Set<() => void>();
  const completions = new Map<string, Promise<string>>();
  let session = store.read();
  let snapshot = toSnapshot(session);
  let refreshing: Promise<Session | null> | undefined;
  /** Sobe a cada troca de sessão: uma renovação que termina depois disso é descartada. */
  let generation = 0;

  function toSnapshot(value: Session | null): AuthSnapshot {
    return value ? { status: 'authenticated', user: value.user } : ANONYMOUS;
  }

  function setSession(next: Session | null) {
    generation += 1;
    session = next;
    if (next) store.write(next);
    else store.clear();
    snapshot = toSnapshot(next);
    for (const listener of [...listeners]) listener();
  }

  async function renew(current: Session): Promise<Session | null> {
    const started = generation;
    try {
      const next = await provider.refresh(current);
      if (generation !== started) return session;
      // Mesmo usuário: a renovação não troca a identidade, só os tokens.
      store.write(next);
      session = next;
      return next;
    } catch (error) {
      if (generation !== started) return session;
      if (error instanceof AuthError && error.kind === 'network') throw error;
      // Refresh token recusado ou resposta inválida: a sessão não se recupera sozinha.
      setSession(null);
      return null;
    }
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    async signIn(options: SignInOptions = {}) {
      const url = await provider.beginSignIn(
        options.screen ?? 'sign-in',
        safeReturnTo(options.returnTo),
      );
      navigate(url);
    },

    completeSignIn(callbackUrl) {
      let existing = completions.get(callbackUrl);
      if (!existing) {
        existing = provider.completeSignIn(callbackUrl).then((result) => {
          setSession(result.session);
          return safeReturnTo(result.returnTo);
        });
        completions.set(callbackUrl, existing);
      }
      return existing;
    },

    async signOut() {
      const ended = session;
      setSession(null);
      refreshing = undefined;
      completions.clear();
      let url = '/';
      try {
        url = await provider.endSession(ended);
      } catch {
        // `endSession` não rejeita; se rejeitar, a sessão local já foi apagada.
      }
      navigate(url);
    },

    async getAccessToken() {
      const current = session;
      if (current === null) return null;
      if (isFresh(current, now())) return current.accessToken;
      if (current.refreshToken === null) {
        setSession(null);
        return null;
      }
      refreshing ??= renew(current).finally(() => {
        refreshing = undefined;
      });
      const renewed = await refreshing;
      return renewed?.accessToken ?? null;
    },
  };
}
