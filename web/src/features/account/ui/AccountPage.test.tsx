import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom'; // o mesmo do app: só ele tem `flushSync`
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type Api, type ApiErrorKind } from '../../../shared/lib/api';
import { ApiProvider } from '../../../shared/lib/api/ApiProvider';
import { createInMemoryApi } from '../../../shared/lib/api/inMemoryApi';
import { expectNoAxeViolations } from '../../../test/axe';
import { fakeAuth } from '../../../test/authFixtures';
import { adrExampleDesign } from '../../../test/designFixtures';
import type { DesignDocument } from '../../../shared/lib/design';
import { AuthProvider, RequireAuth } from '../../auth';
import { savedDesignStore } from '../../designs/hooks/savedDesignStore';
import { AccountPage } from './AccountPage';

const consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
  vi.spyOn(console, m),
);
const EMAIL = 'pessoa@example.com';
const DRAFT_KEY = 'aws-cost-playground:design-draft';

afterEach(() => {
  for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
  window.sessionStorage.clear();
  savedDesignStore.setState({ saved: null, saving: false, error: null });
});

const newApi = (): Api =>
  createInMemoryApi({
    maxDesigns: 5,
    maxDocBytes: 350_000,
    userDailyLimit: 20,
    globalDailyLimit: 300,
  });

const reject = (kind: ApiErrorKind) => () => Promise.reject(new ApiError({ kind } as never));

function mount(api: Api = newApi()) {
  const auth = fakeAuth({ status: 'authenticated', user: { sub: 'u1', email: EMAIL } });
  // Como no app: a sessão cai quando o `signOut` roda.
  auth.service.signOut.mockImplementation(() => {
    auth.set({ status: 'anonymous' });
    return Promise.resolve();
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(
    [
      { path: '/', element: <h1>Editor anônimo</h1> },
      {
        path: '/conta',
        element: (
          <RequireAuth>
            <AccountPage />
          </RequireAuth>
        ),
      },
    ],
    { initialEntries: ['/conta'] },
  );
  const view = render(
    <QueryClientProvider client={client}>
      <ApiProvider api={api}>
        <AuthProvider service={auth.service}>
          <RouterProvider router={router} />
        </AuthProvider>
      </ApiProvider>
    </QueryClientProvider>,
  );
  return { auth, router, client, api, ...view };
}

const open = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(await screen.findByRole('button', { name: /Excluir minha conta/ }));
  return screen.getByRole('dialog');
};

describe('AccountPage', () => {
  it('mostra carregando e depois o e-mail e a quota restante com o período', async () => {
    const { container } = mount();
    expect(screen.getByRole('status')).toHaveTextContent('Carregando suas estimativas');
    expect(await screen.findByText('Restam 20 de 20 estimativas por dia.')).toBeInTheDocument();
    expect(screen.getByText(EMAIL)).toBeInTheDocument();
    expect(screen.getByText(/Renova em/)).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('erro de rede na quota: frase própria e tentar de novo recarrega', async () => {
    const base = newApi();
    let fail = true;
    const api: Api = {
      ...base,
      quota: {
        get: () => (fail ? Promise.reject(new ApiError({ kind: 'network' })) : base.quota.get()),
      },
    };
    mount(api);
    expect(await screen.findByRole('alert')).toHaveTextContent('Sem conexão com o serviço');
    fail = false;
    await userEvent.setup().click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByText(/Restam 20 de 20/)).toBeInTheDocument();
  });

  it('quota com sessão expirada convida a entrar, sem tentar de novo', async () => {
    const { auth } = mount({ ...newApi(), quota: { get: reject('unauthenticated') } });
    expect(await screen.findByRole('alert')).toHaveTextContent('Sua sessão expirou');
    expect(screen.queryByRole('button', { name: 'Tentar de novo' })).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Entrar' }));
    expect(auth.service.signIn).toHaveBeenCalledWith({ returnTo: '/conta' });
  });

  describe('exclusão', () => {
    it('explica o que é apagado, que não há volta, e só libera com a palavra exata', async () => {
      const user = userEvent.setup();
      const { api } = mount();
      const spy = vi.spyOn(api.account, 'deleteAccount');
      const dialog = await open(user);
      expect(within(dialog).getByRole('heading', { name: /Excluir a conta/ })).toBeInTheDocument();
      expect(dialog).toHaveTextContent('designs salvos');
      expect(dialog).toHaveTextContent('contador das suas estimativas');
      expect(dialog).toHaveTextContent('conta de login');
      expect(dialog).toHaveTextContent('Não há volta');
      const field = within(dialog).getByRole('textbox', { name: /Digite EXCLUIR/ });
      expect(field).toHaveValue('');
      expect(field).toHaveFocus();
      const confirm = within(dialog).getByRole('button', { name: 'Excluir conta' });
      expect(confirm).toBeDisabled();
      await user.type(field, 'excluir{Enter}');
      expect(confirm).toBeDisabled();
      expect(spy).not.toHaveBeenCalled();
      await user.clear(field);
      await user.type(field, 'EXCLUIR');
      expect(confirm).toBeEnabled();
      await expectNoAxeViolations(dialog);
    });

    it('Cancelar e Esc fecham sem excluir e o campo volta vazio', async () => {
      const user = userEvent.setup();
      const { api } = mount();
      const spy = vi.spyOn(api.account, 'deleteAccount');
      let dialog = await open(user);
      await user.type(within(dialog).getByRole('textbox'), 'EXCLUIR');
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(screen.getByRole('button', { name: /Excluir minha conta/ })).toHaveFocus();
      dialog = await open(user);
      expect(within(dialog).getByRole('textbox')).toHaveValue('');
      await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(spy).not.toHaveBeenCalled();
    });

    it('depois do 204: apaga os dados, vai ao editor (/) e encerra a sessão, sem abrir o login', async () => {
      const user = userEvent.setup();
      const doc = adrExampleDesign as unknown as DesignDocument;
      const api = newApi();
      await api.designs.create({ name: 'Loja', doc });
      savedDesignStore.setState({ saved: { id: 'X' } as never });
      window.sessionStorage.setItem(DRAFT_KEY, '{"savedAt":1,"text":"{}"}');
      const { auth, router, client } = mount(api);
      client.setQueryData(['designs', 'list'], ['dado do usuário']);
      const dialog = await open(user);
      await user.type(within(dialog).getByRole('textbox'), 'EXCLUIR');
      await user.click(within(dialog).getByRole('button', { name: 'Excluir conta' }));

      expect(await screen.findByRole('heading', { name: 'Editor anônimo' })).toBeInTheDocument();
      await waitFor(() => expect(auth.service.signOut).toHaveBeenCalledTimes(1));
      expect(router.state.location.pathname).toBe('/');
      expect(auth.service.signIn).not.toHaveBeenCalled();
      expect(await api.designs.list()).toEqual([]);
      expect(client.getQueryData(['designs', 'list'])).toBeUndefined();
      expect(window.sessionStorage.getItem(DRAFT_KEY)).toBeNull();
      expect(savedDesignStore.getState().saved).toBeNull();
    });

    it.each(['network', 'unavailable'] as const)(
      'falha %s: a conta não é dada como excluída, a sessão fica e dá para tentar de novo',
      async (kind) => {
        const user = userEvent.setup();
        const base = newApi();
        let fail = true;
        const api: Api = {
          ...base,
          account: {
            deleteAccount: () =>
              fail ? Promise.reject(new ApiError({ kind })) : base.account.deleteAccount(),
          },
        };
        const { auth, router } = mount(api);
        const dialog = await open(user);
        await user.type(within(dialog).getByRole('textbox'), 'EXCLUIR');
        await user.click(within(dialog).getByRole('button', { name: 'Excluir conta' }));

        expect(await within(dialog).findByRole('alert')).toBeInTheDocument();
        expect(dialog).not.toHaveTextContent('Error');
        expect(auth.service.signOut).not.toHaveBeenCalled();
        expect(router.state.location.pathname).toBe('/conta');
        const retry = within(dialog).getByRole('button', { name: 'Tentar de novo' });
        expect(retry).toHaveFocus();
        fail = false;
        await user.click(retry);
        expect(await screen.findByRole('heading', { name: 'Editor anônimo' })).toBeInTheDocument();
        expect(auth.service.signOut).toHaveBeenCalledTimes(1);
      },
    );

    it('sessão expirada na exclusão convida a entrar e não repete a exclusão', async () => {
      const user = userEvent.setup();
      const { auth } = mount({
        ...newApi(),
        account: { deleteAccount: reject('unauthenticated') },
      });
      const dialog = await open(user);
      await user.type(within(dialog).getByRole('textbox'), 'EXCLUIR');
      await user.click(within(dialog).getByRole('button', { name: 'Excluir conta' }));
      expect(await within(dialog).findByRole('alert')).toHaveTextContent('Sua sessão expirou');
      expect(within(dialog).queryByRole('button', { name: /Excluir conta|Tentar/ })).toBeNull();
      await user.click(within(dialog).getByRole('button', { name: 'Entrar' }));
      expect(auth.service.signIn).toHaveBeenCalledWith({ returnTo: '/conta' });
    });

    it('não envia duas vezes, mesmo com cliques repetidos', async () => {
      const user = userEvent.setup();
      const base = newApi();
      let release: () => void = () => undefined;
      const deleteAccount = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      );
      mount({ ...base, account: { deleteAccount } });
      const dialog = await open(user);
      await user.type(within(dialog).getByRole('textbox'), 'EXCLUIR');
      const confirm = within(dialog).getByRole('button', { name: 'Excluir conta' });
      await user.dblClick(confirm);
      expect(deleteAccount).toHaveBeenCalledTimes(1);
      expect(within(dialog).getByRole('status')).toHaveTextContent('Excluindo a conta');
      expect(within(dialog).getByRole('button', { name: 'Cancelar' })).toBeDisabled();
      await user.keyboard('{Escape}');
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      await act(async () => release());
      await screen.findByRole('heading', { name: 'Editor anônimo' });
    });
  });
});
