import { describe, expect, it, vi } from 'vitest';
import { fakeSession, NOW } from '../../../test/authFixtures';
import { createMemorySessionStore } from '../infrastructure/memorySessionStore';
import { AuthError } from '../model/authError';
import type { Session } from '../model/session';
import { createAuthService } from './authService';
import type { IdentityProvider, SessionStore } from './ports';

function setup(initial: Session | null = fakeSession(), now = () => NOW) {
  const store: SessionStore = createMemorySessionStore();
  if (initial) store.write(initial);
  const provider = {
    beginSignIn: vi.fn<IdentityProvider['beginSignIn']>(
      async () => 'https://auth.example.com/login',
    ),
    completeSignIn: vi.fn<IdentityProvider['completeSignIn']>(async () => ({
      session: fakeSession({ accessToken: 'novo-access' }),
      returnTo: '/designs?x=1' as unknown,
    })),
    refresh: vi.fn(async (session: Session) =>
      fakeSession({ ...session, accessToken: 'renovado', expiresAt: NOW + 900_000 }),
    ),
    endSession: vi.fn<IdentityProvider['endSession']>(
      async () => 'https://auth.example.com/logout',
    ),
  } satisfies IdentityProvider;
  const navigate = vi.fn();
  const service = createAuthService({ provider, store, navigate, now });
  return { provider, store, navigate, service };
}

const stale = () => fakeSession({ expiresAt: NOW + 30_000 });

describe('snapshot', () => {
  it('anônimo sem sessão e autenticado com ela, sem expor token', () => {
    expect(setup(null).service.getSnapshot()).toEqual({ status: 'anonymous' });
    const snapshot = setup().service.getSnapshot();
    expect(snapshot).toEqual({ status: 'authenticated', user: fakeSession().user });
    expect(JSON.stringify(snapshot)).not.toContain('token');
  });

  it('a referência é estável até a sessão mudar, e os assinantes são avisados', async () => {
    const { service } = setup(null);
    const first = service.getSnapshot();
    expect(service.getSnapshot()).toBe(first);
    const listener = vi.fn();
    const off = service.subscribe(listener);
    await service.completeSignIn('https://x/auth/callback?code=a&state=b');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(service.getSnapshot()).not.toBe(first);
    off();
    await service.signOut();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('criar o serviço não chama o provedor', () => {
    const { provider } = setup();
    for (const method of Object.values(provider)) expect(method).not.toHaveBeenCalled();
  });
});

describe('signIn', () => {
  it('pede a URL ao provedor e navega; padrão sign-in e `/`', async () => {
    const { service, provider, navigate } = setup(null);
    await service.signIn();
    expect(provider.beginSignIn).toHaveBeenCalledWith('sign-in', '/');
    expect(navigate).toHaveBeenCalledWith('https://auth.example.com/login');
  });

  it.each([
    'https://evil.example/',
    '//evil.example',
    '/auth/callback?code=1',
    'javascript:alert(1)',
  ])('destino fora da lista de rotas internas vira `/`: %s', async (returnTo) => {
    const { service, provider } = setup(null);
    await service.signIn({ screen: 'sign-up', returnTo });
    expect(provider.beginSignIn).toHaveBeenCalledWith('sign-up', '/');
  });

  it('mantém um destino interno', async () => {
    const { service, provider } = setup(null);
    await service.signIn({ returnTo: '/comparar?a=1' });
    expect(provider.beginSignIn).toHaveBeenCalledWith('sign-in', '/comparar?a=1');
  });

  it('se o provedor falhar, rejeita e não navega', async () => {
    const { service, provider, navigate } = setup(null);
    provider.beginSignIn.mockRejectedValueOnce(new AuthError('network'));
    await expect(service.signIn()).rejects.toMatchObject({ kind: 'network' });
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('completeSignIn', () => {
  const url = 'https://app.example.com/auth/callback?code=a&state=b';

  it('guarda a sessão e devolve o destino revalidado', async () => {
    const { service, store } = setup(null);
    await expect(service.completeSignIn(url)).resolves.toBe('/designs?x=1');
    expect(store.read()?.accessToken).toBe('novo-access');
    expect(service.getSnapshot().status).toBe('authenticated');
  });

  it('o destino guardado passa de novo pela lista de rotas internas', async () => {
    const { service, provider } = setup(null);
    provider.completeSignIn.mockResolvedValueOnce({
      session: fakeSession(),
      returnTo: 'https://evil.example/',
    });
    await expect(service.completeSignIn(url)).resolves.toBe('/');
  });

  it('a mesma URL é processada uma vez, mesmo em chamadas simultâneas', async () => {
    const { service, provider } = setup(null);
    await Promise.all([service.completeSignIn(url), service.completeSignIn(url)]);
    await service.completeSignIn(url);
    expect(provider.completeSignIn).toHaveBeenCalledTimes(1);
  });

  it('sair com a troca em voo descarta o resultado dela', async () => {
    const { service, provider } = setup(null);
    let release: (
      value: Awaited<ReturnType<IdentityProvider['completeSignIn']>>,
    ) => void = () => {};
    provider.completeSignIn.mockReturnValueOnce(new Promise((resolve) => (release = resolve)));
    const pending = service.completeSignIn(url);
    await service.signOut();
    release({ session: fakeSession(), returnTo: '/' });
    await expect(pending).rejects.toMatchObject({ kind: 'session-expired' });
    expect(service.getSnapshot().status).toBe('anonymous');
  });

  it('uma falha não derruba a sessão que já existia', async () => {
    const { service, provider } = setup();
    provider.completeSignIn.mockRejectedValueOnce(new AuthError('state-mismatch'));
    await expect(service.completeSignIn(url)).rejects.toMatchObject({ kind: 'state-mismatch' });
    expect(service.getSnapshot().status).toBe('authenticated');
  });
});

describe('getAccessToken', () => {
  it('anônimo: null, sem tocar o provedor', async () => {
    const { service, provider } = setup(null);
    await expect(service.getAccessToken()).resolves.toBeNull();
    expect(provider.refresh).not.toHaveBeenCalled();
  });

  it('token válido: devolve sem renovar', async () => {
    const { service, provider } = setup();
    await expect(service.getAccessToken()).resolves.toBe('access-token-de-teste');
    expect(provider.refresh).not.toHaveBeenCalled();
  });

  it('a menos de um minuto de vencer, renova', async () => {
    const { service, provider } = setup(stale());
    await expect(service.getAccessToken()).resolves.toBe('renovado');
    expect(provider.refresh).toHaveBeenCalledTimes(1);
  });

  it('duas chamadas simultâneas disparam UMA renovação', async () => {
    const { service, provider, store } = setup(stale());
    const tokens = await Promise.all([
      service.getAccessToken(),
      service.getAccessToken(),
      service.getAccessToken(),
    ]);
    expect(tokens).toEqual(['renovado', 'renovado', 'renovado']);
    expect(provider.refresh).toHaveBeenCalledTimes(1);
    expect(store.read()?.accessToken).toBe('renovado');
  });

  it('depois de uma renovação que terminou, uma nova pode acontecer', async () => {
    let clock = NOW;
    const { service, provider } = setup(stale(), () => clock);
    await service.getAccessToken();
    clock = NOW + 900_000;
    await service.getAccessToken();
    expect(provider.refresh).toHaveBeenCalledTimes(2);
  });

  it('sem resposta do provedor: rejeita com network e mantém a sessão', async () => {
    const { service, provider } = setup(stale());
    provider.refresh.mockRejectedValueOnce(new AuthError('network'));
    await expect(service.getAccessToken()).rejects.toMatchObject({ kind: 'network' });
    expect(service.getSnapshot().status).toBe('authenticated');
    await expect(service.getAccessToken()).resolves.toBe('renovado');
  });

  it.each(['session-expired', 'invalid-response'] as const)(
    'refresh recusado (%s): a sessão acaba e o chamador recebe null',
    async (kind) => {
      const { service, provider, store } = setup(stale());
      provider.refresh.mockRejectedValueOnce(new AuthError(kind));
      await expect(service.getAccessToken()).resolves.toBeNull();
      expect(service.getSnapshot()).toEqual({ status: 'anonymous' });
      expect(store.read()).toBeNull();
    },
  );

  it('vencido e sem refresh token: encerra a sessão local', async () => {
    const { service, provider } = setup(fakeSession({ expiresAt: NOW - 1, refreshToken: null }));
    await expect(service.getAccessToken()).resolves.toBeNull();
    expect(service.getSnapshot().status).toBe('anonymous');
    expect(provider.refresh).not.toHaveBeenCalled();
  });

  it('renovação fora do schema: invalid-response encerra a sessão', async () => {
    const { service, provider } = setup(stale());
    provider.refresh.mockResolvedValueOnce(fakeSession({ accessToken: 'com espaço' }));
    await expect(service.getAccessToken()).resolves.toBeNull();
    expect(service.getSnapshot().status).toBe('anonymous');
  });

  it('sair durante a renovação descarta o resultado dela', async () => {
    const { service, provider, store } = setup(stale());
    let release: (session: Session) => void = () => {};
    provider.refresh.mockReturnValueOnce(new Promise<Session>((resolve) => (release = resolve)));
    const pending = service.getAccessToken();
    await service.signOut();
    release(fakeSession({ accessToken: 'tarde-demais' }));
    await expect(pending).resolves.toBeNull();
    expect(store.read()).toBeNull();
    expect(service.getSnapshot().status).toBe('anonymous');
  });
});

describe('signOut', () => {
  it('limpa o que é local ANTES de navegar, revoga pelo provedor e vai ao encerramento', async () => {
    const { service, provider, navigate, store } = setup();
    const session = store.read();
    navigate.mockImplementation(() => {
      expect(store.read()).toBeNull();
      expect(service.getSnapshot().status).toBe('anonymous');
    });
    await service.signOut();
    expect(provider.endSession).toHaveBeenCalledWith(session);
    expect(navigate).toHaveBeenCalledWith('https://auth.example.com/logout');
  });

  it('nunca rejeita: se o provedor falhar, ainda sai e navega para `/`', async () => {
    const { service, provider, navigate } = setup();
    provider.endSession.mockRejectedValueOnce(new Error('falhou'));
    await expect(service.signOut()).resolves.toBeUndefined();
    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('anônimo também navega ao encerramento, sem sessão', async () => {
    const { service, provider } = setup(null);
    await service.signOut();
    expect(provider.endSession).toHaveBeenCalledWith(null);
  });
});
