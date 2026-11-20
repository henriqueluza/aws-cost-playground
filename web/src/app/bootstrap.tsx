import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { loadRuntimeConfig } from '../shared/config';
import { ConfigErrorScreen } from '../shared/ui';
import { routes } from './router';

export async function bootstrap(
  container: HTMLElement,
  fetchFn: typeof fetch = fetch,
): Promise<Root> {
  const root = createRoot(container);
  try {
    await loadRuntimeConfig(fetchFn);
  } catch {
    root.render(
      <StrictMode>
        <ConfigErrorScreen />
      </StrictMode>,
    );
    return root;
  }
  root.render(
    <StrictMode>
      <QueryClientProvider client={new QueryClient()}>
        <RouterProvider router={createBrowserRouter(routes)} />
      </QueryClientProvider>
    </StrictMode>,
  );
  return root;
}
