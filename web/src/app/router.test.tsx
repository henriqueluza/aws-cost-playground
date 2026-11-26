import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AuthProvider } from '../features/auth';
import { fakeAuth } from '../test/authFixtures';
import { routes } from './router';

describe('routes', () => {
  it.each([
    ['/', 'Editor'],
    ['/designs', 'Meus designs'],
    ['/comparar', 'Comparar cenários'],
    ['/conta', 'Conta'],
    ['/privacidade', 'Política de privacidade'],
    ['/termos', 'Termos de uso'],
    ['/auth/callback', 'Entrando'],
  ])('%s mostra o h1 "%s"', (path, name) => {
    const auth = fakeAuth({ status: 'authenticated', user: { sub: 'u1', email: null } });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AuthProvider service={auth.service}>
          <RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />
        </AuthProvider>
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
        <AuthProvider service={auth.service}>
          <RouterProvider router={createMemoryRouter(routes, { initialEntries: ['/'] })} />
        </AuthProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Editor' })).toBeInTheDocument();
    expect(auth.service.signIn).not.toHaveBeenCalled();
    expect(auth.service.getAccessToken).not.toHaveBeenCalled();
  });
});
