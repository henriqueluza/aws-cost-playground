import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reply, validConfig as valid } from '../../test/fixtures';

const json = (override: object = {}) => JSON.stringify({ ...valid, ...override });
const load = async () => import('./runtimeConfig');

describe('runtimeConfig', () => {
  beforeEach(() => vi.resetModules());

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

  it('aceita http em localhost', async () => {
    const { loadRuntimeConfig } = await load();
    const local = { ...valid, apiBaseUrl: 'http://localhost:8000' };
    await expect(loadRuntimeConfig(reply(JSON.stringify(local)))).resolves.toEqual(local);
  });

  it.each([
    ['404', json(), 404],
    ['campo ausente', json({ cognitoClientId: undefined }), 200],
    ['http fora de localhost', json({ apiBaseUrl: 'http://api.example.com' }), 200],
    ['http em host parecido com localhost', json({ apiBaseUrl: 'http://localhost.evil.com' }), 200],
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
