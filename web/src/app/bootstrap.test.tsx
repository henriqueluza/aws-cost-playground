import { act } from 'react';
import type { Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { reply, validConfig as valid } from '../test/fixtures';
import { bootstrap } from './bootstrap';

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
