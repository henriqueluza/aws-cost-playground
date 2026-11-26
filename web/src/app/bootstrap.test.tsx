import { act, useReducer } from 'react';
import type { Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isApiError, type Api } from '../shared/lib/api';
import { useApi } from '../shared/lib/api/ApiProvider';
import { fakeAuth } from '../test/authFixtures';
import { reply, validConfig as valid } from '../test/fixtures';
import { bootstrap, type BootstrapOptions } from './bootstrap';

describe('bootstrap', () => {
  let root: Root | undefined;
  const container = document.createElement('div');
  const run = async (fetchFn: typeof fetch) => {
    await act(async () => {
      root = await bootstrap(container, fetchFn);
    });
  };
  afterEach(() => act(() => root?.unmount()));

  it('config válida renderiza o app', async () => {
    await run(reply(JSON.stringify(valid)));
    expect(container.querySelector('h1')).toHaveTextContent('Editor');
  });

  it.each([
    ['500', reply('', 500)],
    ['JSON sem campo', reply(JSON.stringify({ apiBaseUrl: valid.apiBaseUrl }))],
    ['rede indisponível', vi.fn(() => Promise.reject(new TypeError('Failed to fetch')))],
  ])('config inválida (%s) mostra a tela de erro', async (_name, fetchFn) => {
    await run(fetchFn);
    const alert = container.querySelector('[role="alert"]');
    expect(alert).toHaveTextContent('Não foi possível carregar a configuração');
    expect(container).not.toBeEmptyDOMElement();
  });
});

describe('bootstrap: portas da API', () => {
  // O `act` do React (sem a Testing Library) exige a marca; sem ela, ele avisa em `console.error`.
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let root: Root | undefined;
  const container = document.createElement('div');
  const seen: Api[] = [];
  let rerender = () => {};
  function Probe() {
    rerender = useReducer((n: number) => n + 1, 0)[1];
    seen.push(useApi());
    return <p>sonda</p>;
  }
  const routes = [{ path: '*', Component: Probe }];
  const start = async (options: BootstrapOptions = {}, config: typeof fetch = ok()) => {
    await act(async () => {
      root = await bootstrap(container, config, { routes, ...options });
    });
    return seen.at(-1);
  };
  const ok = () => reply(JSON.stringify(valid));
  const spyFetch = () =>
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('', { status: 503 }));
  const production = () => vi.stubEnv('DEV', false);

  afterEach(() => {
    act(() => root?.unmount());
    seen.length = 0;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    localStorage.clear();
    window.history.replaceState(null, '', '/');
  });

  it('entrega a mesma instância a cada render', async () => {
    const api = await start();
    const before = seen.length;
    await act(async () => rerender());
    await act(async () => rerender());
    expect(seen.length).toBeGreaterThan(before + 1);
    expect(seen.every((seenApi) => seenApi === api)).toBe(true);
  });

  it('em desenvolvimento entrega o fake em memória, sem rede', async () => {
    const fetchSpy = spyFetch();
    const api = await start({ getAccessToken: () => 'tok' });
    await expect(api?.quota.get()).resolves.toMatchObject({ limit: 20, remaining: 20 });
    await expect(api?.designs.list()).resolves.toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('em produção entrega o cliente HTTP, que só fala com a origem do /config.json', async () => {
    production();
    const fetchSpy = spyFetch();
    // Nada que o usuário controla muda a origem.
    window.history.replaceState(null, '', '/?apiBaseUrl=https://evil.example#https://evil.example');
    localStorage.setItem('apiBaseUrl', 'https://evil.example');
    const api = await start({ getAccessToken: () => 'tok' });
    await expect(api?.quota.get()).rejects.toSatisfy((e) => isApiError(e, 'unavailable'));
    await expect(api?.designs.list()).rejects.toSatisfy((e) => isApiError(e, 'unavailable'));
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    for (const [url, init] of fetchSpy.mock.calls) {
      expect(new URL(String(url)).origin).toBe(valid.apiBaseUrl);
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer tok');
    }
  });

  it('em produção, o token do serviço de sessão sai só pelo transporte, só para a origem da API', async () => {
    production();
    const fetchSpy = spyFetch();
    const auth = fakeAuth({ status: 'authenticated', user: { sub: 'u1', email: null } });
    auth.service.getAccessToken.mockResolvedValue('token-da-sessao');
    const api = await start({ auth: auth.service });
    await api?.quota.get().catch(() => undefined);
    const [[url, init]] = fetchSpy.mock.calls as [[string, RequestInit]];
    expect(new URL(String(url)).origin).toBe(valid.apiBaseUrl);
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer token-da-sessao');
  });

  it('em produção, sem provedor de token, responde unauthenticated sem chamar a API', async () => {
    production();
    const fetchSpy = spyFetch();
    localStorage.setItem('accessToken', 'tok');
    document.cookie = 'accessToken=tok';
    const api = await start();
    await expect(api?.quota.get()).rejects.toSatisfy((e) => isApiError(e, 'unauthenticated'));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    ['produção', false],
    ['desenvolvimento', true],
  ])('configuração inválida em %s: tela de erro, sem API e sem fake', async (_name, dev) => {
    vi.stubEnv('DEV', dev);
    const fetchSpy = spyFetch();
    const invalid = { ...valid, apiBaseUrl: 'https://user:pass@api.example.com' };
    for (const config of [reply(JSON.stringify(invalid)), reply('', 404)]) {
      await start({}, config);
      expect(container.querySelector('[role="alert"]')).toHaveTextContent(
        'Não foi possível carregar a configuração',
      );
      act(() => root?.unmount());
    }
    expect(seen).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('não escreve em console', async () => {
    production();
    spyFetch();
    const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
    const spies = methods.map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const api = await start({ getAccessToken: () => 'tok' });
    await api?.quota.get().catch(() => undefined);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});
