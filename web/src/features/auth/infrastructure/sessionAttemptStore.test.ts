import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LoginAttempt } from '../application/ports';
import { createSessionAttemptStore } from './sessionAttemptStore';

const KEY = 'aws-cost-playground:login-attempt';
const ATTEMPT: LoginAttempt = {
  state: 's'.repeat(43),
  verifier: 'v'.repeat(86),
  nonce: 'n'.repeat(43),
  returnTo: '/designs',
  createdAt: 1_795_608_000_000,
};

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, value),
  };
}

describe('createSessionAttemptStore', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(globalThis, 'sessionStorage');
  });

  it('devolve a tentativa uma vez e apaga; uma nova substitui a anterior', () => {
    const storage = memoryStorage();
    const store = createSessionAttemptStore(storage);
    expect(store.save(ATTEMPT)).toBe(true);
    expect(store.take()).toEqual(ATTEMPT);
    expect(storage.length).toBe(0);
    expect(store.take()).toBeNull();
    store.save(ATTEMPT);
    store.save({ ...ATTEMPT, state: 'x'.repeat(43) });
    expect(store.take()?.state).toBe('x'.repeat(43));
  });

  it.each(['não é json', '{"state":"a"}', JSON.stringify({ ...ATTEMPT, token: 'x' })])(
    'trata conteúdo inválido como ausência e o apaga: %s',
    (raw) => {
      const storage = memoryStorage();
      storage.setItem(KEY, raw);
      expect(createSessionAttemptStore(storage).take()).toBeNull();
      expect(storage.length).toBe(0);
    },
  );

  it('armazenamento que lança nunca lança', () => {
    const fail = () => {
      throw new Error('bloqueado');
    };
    const store = createSessionAttemptStore({
      getItem: fail,
      setItem: fail,
      removeItem: fail,
    } as unknown as Storage);
    expect(store.save(ATTEMPT)).toBe(false);
    expect(store.take()).toBeNull();
  });

  it('sessionStorage inacessível (o acesso lança) e destino grande demais: save devolve false', () => {
    vi.stubGlobal('sessionStorage', undefined);
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      get() {
        throw new Error('bloqueado');
      },
    });
    expect(createSessionAttemptStore().save(ATTEMPT)).toBe(false);
    expect(createSessionAttemptStore().take()).toBeNull();
    expect(
      createSessionAttemptStore(memoryStorage()).save({
        ...ATTEMPT,
        returnTo: `/${'a'.repeat(512)}`,
      }),
    ).toBe(false);
  });
});
