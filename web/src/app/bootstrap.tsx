import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createBrowserRouter, type RouteObject } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { AuthProvider, createBrowserAuth, type AuthService } from '../features/auth';
import { loadRuntimeConfig, type RuntimeConfig } from '../shared/config';
import type { Api } from '../shared/lib/api';
import { ApiProvider } from '../shared/lib/api/ApiProvider';
import { QUOTA_LIMITS } from '../shared/lib/api/quotaLimits';
import { createHttpApi, createHttpTransport, type HttpTransportOptions } from '../shared/lib/http';
import { ConfigErrorScreen } from '../shared/ui';
import { routes as appRoutes } from './router';
import { clearCacheOnUserChange } from './sessionCache';

/** Token de acesso da sessão atual, ou `null` sem sessão. Nunca vem de `localStorage` nem de cookie. */
export type AccessTokenProvider = HttpTransportOptions['getAccessToken'];

/** Padrão até a sessão (#52) entrar: sem token, o cliente HTTP responde `unauthenticated` sem chamar a API. */
const noSession: AccessTokenProvider = () => null;

export type BootstrapOptions = {
  /** Troca o provedor do token de acesso (testes). Padrão: o do serviço de sessão. */
  getAccessToken?: AccessTokenProvider;
  /** Troca o serviço de sessão (testes). Padrão: o do Cognito, criado com o `/config.json`. */
  auth?: AuthService;
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
      ...QUOTA_LIMITS,
    });
  }
  return createHttpApi(createHttpTransport({ baseUrl: config.apiBaseUrl, getAccessToken }));
}

/** Carrega `/config.json` e monta o app; se a configuração falhar, mostra a tela de erro. */
export async function bootstrap(
  container: HTMLElement,
  fetchFn = fetch,
  { getAccessToken, auth: injected, routes = appRoutes }: BootstrapOptions = {},
): Promise<Root> {
  const root = createRoot(container);
  const queryClient = new QueryClient();
  // Sem configuração válida não há API, nem a de desenvolvimento: a tela de erro é o único caminho.
  const session = await loadRuntimeConfig(fetchFn)
    .then(async (config) => {
      const auth = injected ?? createBrowserAuth(config, window.location);
      // O token só sai daqui para o transporte HTTP, que só o envia à origem da API.
      const api = await createApi(config, getAccessToken ?? (() => auth.getAccessToken()));
      clearCacheOnUserChange(auth, queryClient);
      return { auth, api };
    })
    .catch(() => null);
  root.render(
    <StrictMode>
      {session ? (
        <QueryClientProvider client={queryClient}>
          <AuthProvider service={session.auth}>
            <ApiProvider api={session.api}>
              <RouterProvider router={createBrowserRouter(routes)} />
            </ApiProvider>
          </AuthProvider>
        </QueryClientProvider>
      ) : (
        <ConfigErrorScreen />
      )}
    </StrictMode>,
  );
  return root;
}
