import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reply, validConfig as valid } from '../../test/fixtures';

const json = (override: object = {}) => JSON.stringify({ ...valid, ...override });
const load = async () => import('./runtimeConfig');

describe('runtimeConfig', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllEnvs());

  it('carrega config válida, sem cache, e a guarda', async () => {
    const fetchFn = reply(json());
    const { loadRuntimeConfig, getRuntimeConfig } = await load();
    await expect(loadRuntimeConfig(fetchFn)).resolves.toEqual(valid);
    expect(getRuntimeConfig()).toEqual(valid);
    expect(fetchFn).toHaveBeenCalledWith(
      '/config.json',
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  it.each(['http://localhost:8000', 'http://127.0.0.1:8000'])(
    'no servidor de desenvolvimento aceita %s',
    async (url) => {
      vi.stubEnv('DEV', true);
      const { loadRuntimeConfig } = await load();
      const local = { ...valid, apiBaseUrl: url, cognitoAuthority: `${url}/pool` };
      await expect(loadRuntimeConfig(reply(JSON.stringify(local)))).resolves.toEqual(local);
    },
  );

  it.each([
    ['apiBaseUrl', 'http://localhost:8000'],
    ['apiBaseUrl', 'http://127.0.0.1:8000'],
    ['cognitoAuthority', 'http://localhost:9229/local_pool'],
    ['apiBaseUrl', 'HTTP://LOCALHOST:8000'],
  ])('fora do servidor de desenvolvimento recusa http em %s (%s)', async (field, url) => {
    vi.stubEnv('DEV', false);
    const { loadRuntimeConfig } = await load();
    await expect(loadRuntimeConfig(reply(json({ [field]: url })))).rejects.toThrow(
      'A configuração do aplicativo é inválida.',
    );
  });

  it('fora do servidor de desenvolvimento segue aceitando https', async () => {
    vi.stubEnv('DEV', false);
    const { loadRuntimeConfig } = await load();
    await expect(loadRuntimeConfig(reply(json()))).resolves.toEqual(valid);
  });

  it.each([
    ['404', json(), 404],
    ['campo ausente', json({ cognitoClientId: undefined }), 200],
    ['http fora de localhost', json({ apiBaseUrl: 'http://api.example.com' }), 200],
    ['http em host parecido com localhost', json({ apiBaseUrl: 'http://localhost.evil.com' }), 200],
    ['credenciais na URL', json({ apiBaseUrl: 'https://user:pass@api.example.com' }), 200],
    ['só usuário na URL', json({ apiBaseUrl: 'https://user@api.example.com' }), 200],
    ['query na URL', json({ apiBaseUrl: 'https://api.example.com/?next=x' }), 200],
    ['fragmento na URL', json({ cognitoAuthority: 'https://idp.example.com/pool#x' }), 200],
    ['javascript:', json({ cognitoAuthority: 'javascript:alert(1)' }), 200],
    ['client id inválido', json({ cognitoClientId: 'a b' }), 200],
    ['corpo não-JSON', '<html>', 200],
  ])('rejeita: %s', async (_name, body, status) => {
    const { loadRuntimeConfig } = await load();
    await expect(loadRuntimeConfig(reply(body, status))).rejects.toThrow();
  });

  it('getRuntimeConfig lança antes do load', async () => {
    const { getRuntimeConfig } = await load();
    expect(() => getRuntimeConfig()).toThrow();
  });
});
