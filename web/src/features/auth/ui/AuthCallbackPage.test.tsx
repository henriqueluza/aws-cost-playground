import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeAuth } from '../../../test/authFixtures';
import { expectNoAxeViolations } from '../../../test/axe';
import { AuthError, type AuthErrorKind } from '../model/authError';
import { AuthCallbackPage } from './AuthCallbackPage';
import { AuthProvider } from './AuthProvider';

const CALLBACK = '/auth/callback?code=CODIGO-SECRETO&state=ESTADO-SECRETO';
const consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
  vi.spyOn(console, m),
);

function mount(auth = fakeAuth(), strict = false) {
  window.history.replaceState(null, '', CALLBACK);
  const router = createMemoryRouter(
    [
      { path: '/auth/callback', Component: AuthCallbackPage },
      { path: '/designs', element: <h1>Destino</h1> },
      { path: '/', element: <h1>Editor</h1> },
    ],
    { initialEntries: ['/auth/callback'] },
  );
  const tree = (
    <AuthProvider service={auth.service}>
      <RouterProvider router={router} />
    </AuthProvider>
  );
  return { auth, ...render(strict ? <StrictMode>{tree}</StrictMode> : tree) };
}

afterEach(() => {
  window.history.replaceState(null, '', '/');
  for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

describe('AuthCallbackPage', () => {
  it('limpa a URL antes de trocar o código e vai ao destino devolvido', async () => {
    const auth = fakeAuth();
    const seen: string[] = [];
    auth.service.completeSignIn.mockImplementation((url) => {
      seen.push(window.location.search, new URL(url).searchParams.get('code') ?? '');
      return Promise.resolve('/designs');
    });
    mount(auth);
    expect(await screen.findByRole('heading', { name: 'Destino' })).toBeInTheDocument();
    // Na hora da troca a barra de endereço já estava limpa, mas a URL entregue ao serviço tinha o `code`.
    expect(seen).toEqual(['', 'CODIGO-SECRETO']);
    expect(window.location.href).not.toContain('SECRETO');
  });

  it('mostra o carregando enquanto a troca está em voo', async () => {
    let finish: (to: string) => void = () => {};
    const auth = fakeAuth();
    auth.service.completeSignIn.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const { container } = mount(auth);
    expect(screen.getByRole('heading', { level: 1, name: 'Entrando' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Confirmando seu login');
    await expectNoAxeViolations(container);
    await act(async () => finish('/'));
    expect(await screen.findByRole('heading', { name: 'Editor' })).toBeInTheDocument();
  });

  it('o StrictMode troca o código uma vez só', async () => {
    const { auth } = mount(fakeAuth(), true);
    await screen.findByRole('heading', { name: 'Editor' });
    expect(auth.service.completeSignIn).toHaveBeenCalledTimes(1);
    expect(auth.service.completeSignIn.mock.calls[0]?.[0]).toContain('code=CODIGO-SECRETO');
  });

  const KINDS: [AuthErrorKind, string][] = [
    ['provider-denied', 'O login não foi concluído'],
    ['state-mismatch', 'não é válido ou já foi usado'],
    ['callback-invalid', 'não é válido ou já foi usado'],
    ['network', 'Verifique a conexão'],
    ['invalid-response', 'de um jeito inesperado'],
  ];
  it.each(KINDS)('erro %s: texto próprio e saída para o editor', async (kind, text) => {
    const auth = fakeAuth();
    auth.service.completeSignIn.mockRejectedValue(new AuthError(kind));
    const { container } = mount(auth);
    expect(await screen.findByRole('alert')).toHaveTextContent(text);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Não foi possível entrar');
    expect(document.body).not.toHaveTextContent('SECRETO');
    expect(screen.getByRole('link', { name: 'Voltar ao editor' })).toHaveAttribute('href', '/');
    await expectNoAxeViolations(container);
  });

  it('erro que não é AuthError vira resposta inesperada, sem a mensagem original', async () => {
    const auth = fakeAuth();
    auth.service.completeSignIn.mockRejectedValue(new Error('detalhe interno'));
    mount(auth);
    expect(await screen.findByRole('alert')).toHaveTextContent('de um jeito inesperado');
    expect(document.body).not.toHaveTextContent('detalhe interno');
  });

  it('tentar de novo pede um login novo para o editor e mostra o progresso', async () => {
    const auth = fakeAuth();
    auth.service.completeSignIn.mockRejectedValue(new AuthError('provider-denied'));
    let fail: (error: unknown) => void = () => {};
    auth.service.signIn.mockReturnValue(new Promise((_, reject) => (fail = reject)));
    mount(auth);
    await userEvent.click(await screen.findByRole('button', { name: 'Tentar de novo' }));
    expect(auth.service.signIn).toHaveBeenCalledWith({ returnTo: '/' });
    const busy = screen.getByRole('button', { name: 'Abrindo o login…' });
    expect(busy).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(busy);
    expect(auth.service.signIn).toHaveBeenCalledTimes(1);
    await act(async () => fail(new AuthError('network')));
    expect(await screen.findByRole('alert')).toHaveTextContent('Verifique a conexão');
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toHaveAttribute(
      'aria-disabled',
      'false',
    );
  });
});
