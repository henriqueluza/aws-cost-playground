import { act } from 'react';
import type { Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bootstrap } from './bootstrap';

const valid = {
  apiBaseUrl: 'https://api.example.com',
  cognitoAuthority: 'https://cognito-idp.us-east-1.amazonaws.com/pool',
  cognitoClientId: 'client-1',
};
const reply = (body: string, status = 200) =>
  vi.fn(() => Promise.resolve(new Response(body, { status })));

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
  ])('config inválida (%s) mostra a tela de erro', async (_name, fetchFn) => {
    await run(fetchFn);
    const alert = container.querySelector('[role="alert"]');
    expect(alert).toHaveTextContent('Não foi possível carregar a configuração');
    expect(container).not.toBeEmptyDOMElement();
  });
});
