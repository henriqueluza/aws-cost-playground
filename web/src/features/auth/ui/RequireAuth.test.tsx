import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { fakeAuth } from '../../../test/authFixtures';
import { expectNoAxeViolations } from '../../../test/axe';
import { AuthError } from '../model/authError';
import { AuthProvider } from './AuthProvider';
import { RequireAuth } from './RequireAuth';

const USER = { status: 'authenticated', user: { sub: 'u1', email: null } } as const;

function mount(auth: ReturnType<typeof fakeAuth>, path = '/designs?x=1', strict = false) {
  const router = createMemoryRouter(
    [
      {
        path: '/designs',
        element: (
          <RequireAuth>
            <h1>Meus designs</h1>
          </RequireAuth>
        ),
      },
      { path: '/', element: <h1>Editor</h1> },
    ],
    { initialEntries: [path] },
  );
  const tree = (
    <AuthProvider service={auth.service}>
      <RouterProvider router={router} />
    </AuthProvider>
  );
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
}

describe('RequireAuth', () => {
  it('sem sessão, leva ao login guardando o destino, uma vez só (mesmo no StrictMode)', async () => {
    const auth = fakeAuth();
    const { container } = mount(auth, '/designs?x=1', true);
    expect(auth.service.signIn).toHaveBeenCalledTimes(1);
    expect(auth.service.signIn).toHaveBeenCalledWith({ returnTo: '/designs?x=1' });
    expect(screen.getByRole('status')).toHaveTextContent('Levando você ao login');
    expect(screen.queryByRole('heading', { name: 'Meus designs' })).not.toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('com sessão, mostra a página e não pede login', () => {
    const auth = fakeAuth(USER);
    mount(auth);
    expect(screen.getByRole('heading', { name: 'Meus designs' })).toBeInTheDocument();
    expect(auth.service.signIn).not.toHaveBeenCalled();
  });

  it('a sessão que aparece troca a espera pela página', async () => {
    const auth = fakeAuth();
    mount(auth);
    await act(async () => auth.set(USER));
    expect(screen.getByRole('heading', { name: 'Meus designs' })).toBeInTheDocument();
  });

  it('falha ao abrir o login: texto próprio, Entrar de novo e saída para o editor', async () => {
    const auth = fakeAuth();
    auth.service.signIn.mockRejectedValueOnce(new AuthError('network'));
    const { container } = mount(auth);
    expect(await screen.findByRole('alert')).toHaveTextContent('Verifique a conexão');
    expect(screen.getByRole('link', { name: 'Voltar ao editor' })).toHaveAttribute('href', '/');
    await expectNoAxeViolations(container);
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(auth.service.signIn).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('uma segunda queda da sessão pede o login de novo', async () => {
    const auth = fakeAuth(USER);
    mount(auth);
    await act(async () => auth.set({ status: 'anonymous' }));
    await act(async () => auth.set(USER));
    await act(async () => auth.set({ status: 'anonymous' }));
    expect(auth.service.signIn).toHaveBeenCalledTimes(2);
  });
});
