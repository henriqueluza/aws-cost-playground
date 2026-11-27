import { describe, expect, it, vi } from 'vitest';
import { createBrowserAuth } from './browserAuth';

const CONFIG = {
  apiBaseUrl: 'https://api.example.com',
  cognitoAuthority: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_Teste',
  cognitoClientId: 'cliente',
  selfSignupEnabled: false,
};

function fakeLocation(origin = 'https://app.example.com') {
  return { origin, assign: vi.fn() } as unknown as Location & { assign: ReturnType<typeof vi.fn> };
}

describe('createBrowserAuth', () => {
  it('nasce anônimo e sem tocar a rede', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const auth = createBrowserAuth(CONFIG, fakeLocation());
    expect(auth.getSnapshot()).toEqual({ status: 'anonymous' });
    await expect(auth.getAccessToken()).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('o cadastro segue o `selfSignupEnabled` do /config.json', () => {
    expect(createBrowserAuth(CONFIG, fakeLocation()).signUpAvailable).toBe(false);
    const open = { ...CONFIG, selfSignupEnabled: true };
    expect(createBrowserAuth(open, fakeLocation()).signUpAvailable).toBe(true);
  });

  it('o retorno inválido é recusado com erro próprio, sem rede', async () => {
    const location = fakeLocation();
    const auth = createBrowserAuth(CONFIG, location);
    await expect(
      auth.completeSignIn('https://app.example.com/auth/callback'),
    ).rejects.toMatchObject({ kind: 'callback-invalid' });
    expect(location.assign).not.toHaveBeenCalled();
  });

  it('sair sem descoberta volta para a própria origem', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('rede'));
    const location = fakeLocation();
    await createBrowserAuth(CONFIG, location).signOut();
    expect(location.assign).toHaveBeenCalledExactlyOnceWith('https://app.example.com/');
    fetchSpy.mockRestore();
  });
});
