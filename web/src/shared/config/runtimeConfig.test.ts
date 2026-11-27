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

  it('sem `selfSignupEnabled` o cadastro vale fechado; `true` abre', async () => {
    const { loadRuntimeConfig } = await load();
    const absent = await loadRuntimeConfig(reply(json({ selfSignupEnabled: undefined })));
    expect(absent.selfSignupEnabled).toBe(false);
    const open = await loadRuntimeConfig(reply(json({ selfSignupEnabled: true })));
    expect(open.selfSignupEnabled).toBe(true);
  });

  it.each([
    ['404', json(), 404],
    ['cadastro como texto', json({ selfSignupEnabled: 'true' }), 200],
    ['cadastro como número', json({ selfSignupEnabled: 1 }), 200],
    ['cadastro nulo', json({ selfSignupEnabled: null }), 200],
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
