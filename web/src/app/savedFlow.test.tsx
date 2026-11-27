import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiProvider } from '../shared/lib/api/ApiProvider';
import { createInMemoryApi } from '../shared/lib/api/inMemoryApi';
import type { DesignDocument } from '../shared/lib/design';
import { AuthProvider } from '../features/auth';
import { forgetSavedDesign } from '../features/designs';
import { designStore } from '../features/editor';
import { adrExampleDesign } from '../test/designFixtures';
import { fakeAuth } from '../test/authFixtures';
import { routes } from './router';

/** Salvar × template inicial × "Novo design" (#326): o fluxo inteiro, pelas rotas do app. */
const doc = adrExampleDesign as unknown as DesignDocument;
const newApi = () =>
  createInMemoryApi({
    maxDesigns: 10,
    maxDocBytes: 100_000,
    userDailyLimit: 20,
    globalDailyLimit: 300,
  });

function mount(api = newApi(), path = '/') {
  const auth = fakeAuth({ status: 'authenticated', user: { sub: 'u1', email: null } });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ApiProvider api={api}>
        <AuthProvider service={auth.service}>
          <RouterProvider router={router} />
        </AuthProvider>
      </ApiProvider>
    </QueryClientProvider>,
  );
  return { api, router, user: userEvent.setup({ applyAccept: false }) };
}

const pill = () => screen.getAllByRole('status').map((e) => e.textContent);
const blocksOf = (store = designStore) => store.getState().document.blocks.length;
/** O navegador perguntaria ao fechar a aba? (algum `beforeunload` chamou preventDefault) */
const wouldWarnOnUnload = () => {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
};

async function saveAs(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole('button', { name: 'Salvar' }));
  const dialog = screen.getByRole('dialog', { name: 'Salvar design' });
  await user.clear(within(dialog).getByLabelText('Nome do design'));
  await user.type(within(dialog).getByLabelText('Nome do design'), name);
  await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));
  await waitFor(() => expect(pill()).toContain('Salvo'));
}

beforeEach(() => {
  act(() => designStore.getState().newDesign());
  designStore.setState({ history: { past: [], future: [] } });
});
afterEach(() => {
  forgetSavedDesign();
});

describe('depois de salvar, o editor considera o documento salvo', () => {
  it('"Novo design" cria direto e a aba fecha sem aviso', async () => {
    const { user } = mount();
    act(() => void designStore.getState().setRegion('sa-east-1'));
    expect(wouldWarnOnUnload()).toBe(true);
    await saveAs(user, 'Loja');
    expect(wouldWarnOnUnload()).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Novo design' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(designStore.getState().document.region).toBe('us-east-1');
  });

  it('editar durante o salvamento deixa o design "não salvo"', async () => {
    const api = newApi();
    const create = api.designs.create;
    let release = () => {};
    api.designs.create = async (input) => {
      await new Promise<void>((resolve) => (release = resolve));
      return create(input);
    };
    const { user } = mount(api);
    act(() => void designStore.getState().setRegion('sa-east-1'));
    await saveAs(user, 'Loja').catch(() => undefined); // a resposta ainda não chegou
    await waitFor(() => expect(pill()).toContain('Salvando…'));
    act(() => void designStore.getState().setRegion('us-east-1')); // edição durante a chamada
    release();
    await waitFor(() => expect(pill()).toContain('Alterações não salvas'));
    expect(wouldWarnOnUnload()).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Novo design' }));
    expect(screen.getByRole('dialog', { name: 'Descartar as alterações?' })).toBeInTheDocument();
  });
});

describe('o template inicial intocado não é trabalho a perder', () => {
  it('ir a "Meus designs" e recarregar não pedem confirmação', async () => {
    const { user, router } = mount();
    expect(wouldWarnOnUnload()).toBe(false);
    await user.click(screen.getByRole('link', { name: 'Meus designs' }));
    expect(screen.queryByRole('dialog', { name: 'Sair sem salvar?' })).not.toBeInTheDocument();
    await waitFor(() => expect(router.state.location.pathname).toBe('/designs'));
  });

  it('abrir um design da lista não pede confirmação', async () => {
    const api = newApi();
    await api.designs.create({ name: 'Antigo', doc });
    const { user, router } = mount(api, '/designs');
    await user.click(await screen.findByRole('button', { name: 'Abrir Antigo' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(blocksOf()).toBe(doc.blocks.length);
  });
});

describe('"Novo design" e "Abrir arquivo" desfazem o vínculo com o design salvo', () => {
  /** Um design salvo e aberto pela lista, sem alterações. */
  async function savedAndOpen() {
    const api = newApi();
    const created = await api.designs.create({ name: 'Original', doc });
    const m = mount(api, '/designs');
    await m.user.click(await screen.findByRole('button', { name: 'Abrir Original' }));
    await waitFor(() => expect(m.router.state.location.pathname).toBe('/'));
    await waitFor(() => expect(pill()).toContain('Salvo'));
    return { ...m, id: created.id };
  }
  const expectAsksName = async (
    user: ReturnType<typeof userEvent.setup>,
    api: ReturnType<typeof newApi>,
    id: string,
  ) => {
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(screen.getByRole('dialog', { name: 'Salvar design' })).toBeInTheDocument();
    const kept = await api.designs.get(id);
    expect(kept.version).toBe(1);
    expect((kept.doc as DesignDocument).blocks).toHaveLength(doc.blocks.length);
  };

  it('"Novo design": Salvar pede um nome novo e o design salvo fica intacto', async () => {
    const { user, api, id } = await savedAndOpen();
    await user.click(screen.getByRole('button', { name: 'Novo design' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('Original')).not.toBeInTheDocument();
    expect(pill()).toContain('Não salvo');
    await expectAsksName(user, api, id);
  });

  it('"Abrir arquivo" faz o mesmo', async () => {
    const { user, api, id } = await savedAndOpen();
    const file = new File([JSON.stringify({ ...doc, region: 'sa-east-1' })], 'd.json', {
      type: 'application/json',
    });
    await user.upload(screen.getByLabelText('Arquivo JSON do design'), file);
    await waitFor(() => expect(designStore.getState().document.region).toBe('sa-east-1'));
    await expectAsksName(user, api, id);
  });

  it('desfazer o "Novo design" não devolve o vínculo: Salvar pede nome', async () => {
    const { user, api, id } = await savedAndOpen();
    await user.click(screen.getByRole('button', { name: 'Novo design' }));
    await user.click(screen.getByRole('button', { name: 'Desfazer' }));
    expect(blocksOf()).toBe(doc.blocks.length);
    await expectAsksName(user, api, id);
  });

  it('desfazer a abertura de um design da lista também solta o vínculo', async () => {
    const { user, api, id } = await savedAndOpen();
    await user.click(await screen.findByRole('button', { name: 'Desfazer' }));
    await expectAsksName(user, api, id);
  });

  it('um salvamento em andamento não religa o design depois de "Novo design"', async () => {
    const { user, api } = await savedAndOpen();
    act(() => void designStore.getState().setRegion('sa-east-1'));
    const update = api.designs.update;
    let release = () => {};
    api.designs.update = async (id, input) => {
      await new Promise<void>((resolve) => (release = resolve));
      return update(id, input);
    };
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await user.click(screen.getByRole('button', { name: 'Novo design' }));
    await user.click(screen.getByRole('button', { name: 'Descartar e criar novo design' }));
    release();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Salvar' })).toBeEnabled());
    expect(screen.queryByText('Original')).not.toBeInTheDocument();
    expect(pill()).toContain('Não salvo');
  });
});
