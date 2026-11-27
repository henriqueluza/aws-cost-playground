import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { ApiProvider } from '../shared/lib/api/ApiProvider';
import { createInMemoryApi } from '../shared/lib/api/inMemoryApi';
import { AuthProvider } from '../features/auth';
import { designStore } from '../features/editor';
import { adrExampleDesign } from '../test/designFixtures';
import { fakeAuth } from '../test/authFixtures';
import { routes } from './router';

const api = createInMemoryApi({
  maxDesigns: 50,
  maxDocBytes: 350_000,
  userDailyLimit: 5,
  globalDailyLimit: 30,
});

describe('routes', () => {
  it.each([
    ['/', 'Editor'],
    ['/designs', 'Meus designs'],
    ['/comparar', 'Comparar designs'],
    ['/conta', 'Conta'],
    ['/privacidade', 'Política de privacidade'],
    ['/termos', 'Termos de uso'],
    ['/auth/callback', 'Entrando'],
  ])('%s mostra o h1 "%s"', (path, name) => {
    const auth = fakeAuth({ status: 'authenticated', user: { sub: 'u1', email: null } });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ApiProvider api={api}>
          <AuthProvider service={auth.service}>
            <RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />
          </AuthProvider>
        </ApiProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByRole('heading', { level: 1, name })).toBeInTheDocument();
  });

  it.each(['/designs', '/conta'])('%s sem sessão leva ao login guardando o destino', (path) => {
    const auth = fakeAuth();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AuthProvider service={auth.service}>
          <RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />
        </AuthProvider>
      </QueryClientProvider>,
    );
    expect(auth.service.signIn).toHaveBeenCalledWith({ returnTo: path });
  });

  it('o editor anônimo abre sem pedir login', () => {
    const auth = fakeAuth();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ApiProvider api={api}>
          <AuthProvider service={auth.service}>
            <RouterProvider router={createMemoryRouter(routes, { initialEntries: ['/'] })} />
          </AuthProvider>
        </ApiProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Editor' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Comparar' })).toHaveAttribute('href', '/comparar');
    expect(auth.service.signIn).not.toHaveBeenCalled();
    expect(auth.service.getAccessToken).not.toHaveBeenCalled();
  });

  it.each([
    ['anônimo', { status: 'anonymous' } as const, ['Entrar', 'Criar conta']],
    [
      'com sessão',
      { status: 'authenticated', user: { sub: 'u1', email: null } } as const,
      ['Sair'],
    ],
  ])('a barra do editor, %s, tem os botões da conta', (_name, snapshot, names) => {
    const auth = fakeAuth(snapshot);
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ApiProvider api={api}>
          <AuthProvider service={auth.service}>
            <RouterProvider router={createMemoryRouter(routes, { initialEntries: ['/'] })} />
          </AuthProvider>
        </ApiProvider>
      </QueryClientProvider>,
    );
    for (const name of names) expect(screen.getByRole('button', { name })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeInTheDocument();
  });

  it('Entrar, na barra, guarda o design em edição antes de ir ao login', async () => {
    const auth = fakeAuth();
    const draftAtSignIn: (string | null)[] = [];
    auth.service.signIn.mockImplementation(() => {
      draftAtSignIn.push(sessionStorage.getItem('aws-cost-playground:design-draft'));
      return Promise.resolve();
    });
    designStore.getState().loadDesign(adrExampleDesign);
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ApiProvider api={api}>
          <AuthProvider service={auth.service}>
            <RouterProvider router={createMemoryRouter(routes, { initialEntries: ['/'] })} />
          </AuthProvider>
        </ApiProvider>
      </QueryClientProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(draftAtSignIn).toHaveLength(1);
    expect(draftAtSignIn[0]).toContain('API REST com 3 milh');
    sessionStorage.clear();
    designStore
      .getState()
      .loadDesign({ ...adrExampleDesign, blocks: [], edges: [], workload: { description: '' } });
  });
});
