import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createBrowserRouter, type RouteObject } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { loadRuntimeConfig, type RuntimeConfig } from '../shared/config';
import type { Api } from '../shared/lib/api';
import { ApiProvider } from '../shared/lib/api/ApiProvider';
import { createHttpApi, createHttpTransport, type HttpTransportOptions } from '../shared/lib/http';
import { ConfigErrorScreen } from '../shared/ui';
import { routes as appRoutes } from './router';

/** Token de acesso da sessão atual, ou `null` sem sessão. Nunca vem de `localStorage` nem de cookie. */
export type AccessTokenProvider = HttpTransportOptions['getAccessToken'];

/** Padrão até a sessão (#52) entrar: sem token, o cliente HTTP responde `unauthenticated` sem chamar a API. */
const noSession: AccessTokenProvider = () => null;

export type BootstrapOptions = {
  /** Ponto de injeção da sessão (#52): o `main.tsx` passa aqui o provedor do token de acesso. */
  getAccessToken?: AccessTokenProvider;
  /** Padrão: as rotas do app. */
  routes?: RouteObject[];
};

/**
 * Escolhe a implementação das portas. Em desenvolvimento, o fake em memória com os limites do
 * ADR-0001; o `import()` fica dentro do `if` para o fake não entrar no bundle de produção. Em
 * produção, sempre o cliente HTTP, com a URL base do `/config.json` já validado.
 */
export async function createApi(
  config: RuntimeConfig,
  getAccessToken: AccessTokenProvider = noSession,
): Promise<Api> {
  if (import.meta.env.DEV) {
    const { createInMemoryApi } = await import('../shared/lib/api/inMemoryApi');
    return createInMemoryApi({
      maxDesigns: 50,
      maxDocBytes: 350_000,
      userDailyLimit: 20,
      globalDailyLimit: 300,
    });
  }
  return createHttpApi(createHttpTransport({ baseUrl: config.apiBaseUrl, getAccessToken }));
}

/** Carrega `/config.json` e monta o app; se a configuração falhar, mostra a tela de erro. */
export async function bootstrap(
  container: HTMLElement,
  fetchFn = fetch,
  { getAccessToken, routes = appRoutes }: BootstrapOptions = {},
): Promise<Root> {
  const root = createRoot(container);
  // Sem configuração válida não há API, nem a de desenvolvimento: a tela de erro é o único caminho.
  const api = await loadRuntimeConfig(fetchFn)
    .then((config) => createApi(config, getAccessToken))
    .catch(() => null);
  root.render(
    <StrictMode>
      {api ? (
        <QueryClientProvider client={new QueryClient()}>
          <ApiProvider api={api}>
            <RouterProvider router={createBrowserRouter(routes)} />
          </ApiProvider>
        </QueryClientProvider>
      ) : (
        <ConfigErrorScreen />
      )}
    </StrictMode>,
  );
  return root;
}
