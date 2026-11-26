import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { fakeAuth } from '../test/authFixtures';
import { clearCacheOnUserChange } from './sessionCache';

const user = (sub: string) => ({ status: 'authenticated', user: { sub, email: null } }) as const;

function setup(initial = user('a')) {
  const auth = fakeAuth(initial);
  const client = new QueryClient();
  client.setQueryData(['designs', 'list'], ['do usuário A']);
  const stop = clearCacheOnUserChange(auth.service, client);
  return { auth, client, stop };
}

describe('clearCacheOnUserChange', () => {
  it('ao sair, o cache do usuário some', () => {
    const { auth, client } = setup();
    auth.set({ status: 'anonymous' });
    expect(client.getQueryData(['designs', 'list'])).toBeUndefined();
  });

  it('ao trocar de usuário, o cache do anterior some', () => {
    const { auth, client } = setup();
    auth.set(user('b'));
    expect(client.getQueryData(['designs', 'list'])).toBeUndefined();
  });

  it('ao entrar, o que foi lido sem sessão some', () => {
    const { auth, client } = setup({ status: 'anonymous' } as never);
    auth.set(user('a'));
    expect(client.getQueryData(['designs', 'list'])).toBeUndefined();
  });

  it('sem mudança de usuário (renovação, mesmo sub) o cache fica', () => {
    const { auth, client } = setup();
    auth.set(user('a'));
    expect(client.getQueryData(['designs', 'list'])).toEqual(['do usuário A']);
  });

  it('cancelar a inscrição para de limpar', () => {
    const { auth, client, stop } = setup();
    stop();
    auth.set({ status: 'anonymous' });
    expect(client.getQueryData(['designs', 'list'])).toEqual(['do usuário A']);
  });
});
