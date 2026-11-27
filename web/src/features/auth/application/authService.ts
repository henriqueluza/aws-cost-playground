import { AuthError } from '../model/authError';
import { isFresh, sessionSchema, type Session } from '../model/session';
import { safeReturnTo } from '../model/returnTo';
import type { AuthService, AuthServiceDeps, AuthSnapshot, SignInOptions } from './ports';

const ANONYMOUS: AuthSnapshot = { status: 'anonymous' };

/** Sessão do usuário: guarda o estado, renova o access token (uma renovação por vez) e sai. */
export function createAuthService(deps: AuthServiceDeps): AuthService {
  const { provider, store, navigate } = deps;
  const now = deps.now ?? Date.now;
  const signUpAvailable = deps.signUpAvailable ?? false;
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
      const refreshed = await provider.refresh(current);
      if (generation !== started) return session;
      const checked = sessionSchema.safeParse(refreshed);
      // A renovação troca os tokens, nunca a identidade.
      if (!checked.success || checked.data.user.sub !== current.user.sub) {
        throw new AuthError('invalid-response');
      }
      const next = checked.data;
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
    signUpAvailable,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    async signIn(options: SignInOptions = {}) {
      const asked = options.screen ?? 'sign-in';
      const screen = asked === 'sign-up' && !signUpAvailable ? 'sign-in' : asked;
      const url = await provider.beginSignIn(screen, safeReturnTo(options.returnTo));
      navigate(url);
    },

    completeSignIn(callbackUrl) {
      let existing = completions.get(callbackUrl);
      if (!existing) {
        const started = generation;
        existing = provider.completeSignIn(callbackUrl).then((result) => {
          // Saiu enquanto a troca estava em voo: o resultado não vale mais.
          if (generation !== started) throw new AuthError('session-expired');
          const checked = sessionSchema.safeParse(result.session);
          if (!checked.success) throw new AuthError('invalid-response');
          setSession(checked.data);
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
      const flight: Promise<Session | null> = (refreshing ??= renew(current).finally(() => {
        if (refreshing === flight) refreshing = undefined;
      }));
      const renewed = await flight;
      return renewed?.accessToken ?? null;
    },
  };
}
