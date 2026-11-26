import { describe, expect, it } from 'vitest';
import { fakeSession } from '../../../test/authFixtures';
import { createMemorySessionStore } from './memorySessionStore';

describe('createMemorySessionStore', () => {
  it('guarda, lê e limpa', () => {
    const store = createMemorySessionStore();
    expect(store.read()).toBeNull();
    store.write(fakeSession());
    expect(store.read()).toEqual(fakeSession());
    store.clear();
    expect(store.read()).toBeNull();
  });

  it('não grava nada em sessionStorage, localStorage nem cookie', () => {
    const store = createMemorySessionStore();
    store.write(fakeSession());
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.length).toBe(0);
    expect(document.cookie).toBe('');
  });

  it('descarta sessão fora do schema', () => {
    const store = createMemorySessionStore();
    store.write(fakeSession({ accessToken: 'token com espaço' }));
    expect(store.read()).toBeNull();
  });
});
