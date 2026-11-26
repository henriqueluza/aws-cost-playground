import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
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
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />
      </QueryClientProvider>,
    );
    expect(screen.getByRole('heading', { level: 1, name })).toBeInTheDocument();
  });
});
