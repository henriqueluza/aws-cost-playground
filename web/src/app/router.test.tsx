import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { ApiProvider } from '../shared/lib/api/ApiProvider';
import { createInMemoryApi } from '../shared/lib/api/inMemoryApi';
import { routes } from './router';

const api = createInMemoryApi({
  maxDesigns: 50,
  maxDocBytes: 350_000,
  userDailyLimit: 20,
  globalDailyLimit: 300,
});

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
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ApiProvider api={api}>
          <RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />
        </ApiProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByRole('heading', { level: 1, name })).toBeInTheDocument();
  });
});
