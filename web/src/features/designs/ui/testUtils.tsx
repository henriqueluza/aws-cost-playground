import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { ApiProvider } from '../../../shared/lib/api/ApiProvider';
import { createInMemoryApi } from '../../../shared/lib/api/inMemoryApi';
import { ApiError, type Api, type ApiErrorKind } from '../../../shared/lib/api';

export const newApi = (): Api =>
  createInMemoryApi({
    maxDesigns: 2,
    maxDocBytes: 350_000,
    userDailyLimit: 5,
    globalDailyLimit: 5,
  });

/** Api cujas chamadas de `designs` falham com `kind` (para os estados de erro). */
export const failingApi = (kind: ApiErrorKind, base = newApi()): Api => {
  const boom = () => Promise.reject(new ApiError({ kind } as never));
  return {
    ...base,
    designs: { ...base.designs, list: boom, get: boom, create: boom, update: boom },
  };
};

/** Monta `ui` em `/` e uma página marcada em `/designs`, com a API dada. */
export function renderWithApp(api: Api, ui: ReactNode, other: ReactNode = <p>Outra página</p>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(
    [
      { path: '/', element: ui },
      { path: '/designs', element: other },
    ],
    { initialEntries: ['/'] },
  );
  const view = render(
    <QueryClientProvider client={client}>
      <ApiProvider api={api}>
        <RouterProvider router={router} />
      </ApiProvider>
    </QueryClientProvider>,
  );
  return { ...view, router, client };
}
