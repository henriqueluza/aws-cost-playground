import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { fakeAuth } from '../../../test/authFixtures';
import { expectNoAxeViolations } from '../../../test/axe';
import { AuthError } from '../model/authError';
import { AuthActions, SignInButton } from './AuthActions';
import { AuthProvider } from './AuthProvider';

const USER = { status: 'authenticated', user: { sub: 'u1', email: 'pessoa@example.com' } } as const;

function mount(auth: ReturnType<typeof fakeAuth>, ui = <AuthActions />, path = '/?x=1') {
  const router = createMemoryRouter(
    [
      { path: '/', element: ui },
      { path: '/conta', element: <h1>Conta</h1> },
    ],
    { initialEntries: [path] },
  );
  return render(
    <AuthProvider service={auth.service}>
      <RouterProvider router={router} />
    </AuthProvider>,
  );
}

describe('AuthActions', () => {
  it('anônimo: Entrar guarda o design e leva ao login voltando à mesma página', async () => {
    const auth = fakeAuth();
    const order: string[] = [];
    const keep = vi.fn(() => order.push('guarda'));
    auth.service.signIn.mockImplementation(() => {
      order.push('login');
      return Promise.resolve();
    });
    const { container } = mount(auth, <AuthActions beforeSignIn={keep} />);
    await expectNoAxeViolations(container);
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(order).toEqual(['guarda', 'login']);
    expect(auth.service.signIn).toHaveBeenCalledWith({ screen: 'sign-in', returnTo: '/?x=1' });
  });

  it('Criar conta pede a tela de cadastro', async () => {
    const auth = fakeAuth();
    mount(auth);
    await userEvent.click(screen.getByRole('button', { name: 'Criar conta' }));
    expect(auth.service.signIn).toHaveBeenCalledWith({ screen: 'sign-up', returnTo: '/?x=1' });
  });

  it('mostra o progresso e ignora o segundo clique enquanto abre o login', async () => {
    const auth = fakeAuth();
    auth.service.signIn.mockReturnValue(new Promise(() => {}));
    mount(auth);
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    const busy = screen.getByRole('button', { name: 'Abrindo…' });
    expect(busy).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('Abrindo o login…')).toHaveAttribute('role', 'status');
    await expectNoAxeViolations(document.body);
    await userEvent.click(busy);
    await userEvent.click(screen.getByRole('button', { name: 'Criar conta' }));
    expect(auth.service.signIn).toHaveBeenCalledTimes(1);
  });

  it('falha ao abrir o login: diálogo com texto próprio e tentar de novo', async () => {
    const auth = fakeAuth();
    auth.service.signIn.mockRejectedValueOnce(new AuthError('network'));
    mount(auth);
    await userEvent.click(screen.getByRole('button', { name: 'Criar conta' }));
    const dialog = await screen.findByRole('dialog', { name: 'Não foi possível abrir o login' });
    expect(dialog).toHaveTextContent('Verifique a conexão');
    await expectNoAxeViolations(document.body);
    expect(screen.getByRole('button', { name: 'Entrar' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(auth.service.signIn).toHaveBeenLastCalledWith({ screen: 'sign-up', returnTo: '/?x=1' });
    expect(auth.service.signIn).toHaveBeenCalledTimes(2);
  });

  it('com sessão: o e-mail leva à conta e Sair encerra a sessão uma vez', async () => {
    const auth = fakeAuth(USER);
    const { container } = mount(auth);
    await expectNoAxeViolations(container);
    expect(screen.queryByRole('button', { name: 'Entrar' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Conta de pessoa@example.com' })).toHaveAttribute(
      'href',
      '/conta',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Sair' }));
    await userEvent.click(screen.getByRole('button', { name: 'Saindo…' }));
    expect(auth.service.signOut).toHaveBeenCalledTimes(1);
  });

  it('voltar do login pelo botão do navegador (página do cache) destrava os botões', async () => {
    const auth = fakeAuth();
    auth.service.signIn.mockReturnValue(new Promise(() => {}));
    mount(auth);
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(screen.getByRole('button', { name: 'Abrindo…' })).toBeInTheDocument();
    act(() => {
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    });
    expect(screen.getByRole('button', { name: 'Entrar' })).toHaveAttribute(
      'aria-disabled',
      'false',
    );
  });

  it('sem e-mail verificado, o link diz só "Conta"', () => {
    mount(fakeAuth({ status: 'authenticated', user: { sub: 'u1', email: null } }));
    expect(screen.getByRole('link', { name: 'Conta' })).toBeInTheDocument();
  });

  it('a sessão que aparece troca Entrar por Sair', async () => {
    const auth = fakeAuth();
    mount(auth);
    await act(async () => auth.set(USER));
    expect(screen.getByRole('button', { name: 'Sair' })).toBeInTheDocument();
  });
});

describe('SignInButton', () => {
  it('é o Entrar que outras features recebem', async () => {
    const auth = fakeAuth();
    const keep = vi.fn();
    mount(auth, <SignInButton beforeSignIn={keep} />);
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(keep).toHaveBeenCalledOnce();
    expect(auth.service.signIn).toHaveBeenCalledWith({ screen: 'sign-in', returnTo: '/?x=1' });
  });
});
