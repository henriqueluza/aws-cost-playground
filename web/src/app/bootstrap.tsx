import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { loadRuntimeConfig } from '../shared/config';
import { ConfigErrorScreen } from '../shared/ui';
import { routes } from './router';

/** Carrega `/config.json` e monta o app; se a configuração falhar, mostra a tela de erro. */
export async function bootstrap(container: HTMLElement, fetchFn = fetch): Promise<Root> {
  const root = createRoot(container);
  const configured = await loadRuntimeConfig(fetchFn).then(
    () => true,
    () => false,
  );
  root.render(
    <StrictMode>
      {configured ? (
        <QueryClientProvider client={new QueryClient()}>
          <RouterProvider router={createBrowserRouter(routes)} />
        </QueryClientProvider>
      ) : (
        <ConfigErrorScreen />
      )}
    </StrictMode>,
  );
  return root;
}
