import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { adrExampleDesign } from '../../../test/designFixtures';
import { expectNoAxeViolations } from '../../../test/axe';
import { designStore, EMPTY_STATE } from '../../editor';
import type { Api } from '../../../shared/lib/api';
import type { DesignDocument } from '../../../shared/lib/design';
import { savedDesignStore } from '../hooks/savedDesignStore';
import { DesignsPage } from './DesignsPage';
import { failingApi, newApi, renderWithApp } from './testUtils';

const doc = adrExampleDesign as unknown as DesignDocument;

afterEach(() => {
  designStore.setState({ ...EMPTY_STATE, baseline: EMPTY_STATE.document });
  savedDesignStore.setState({ saved: null, saving: false, error: null });
});

const seed = async (api: Api, ...names: string[]) => {
  for (const name of names) await api.designs.create({ name, doc });
};

describe('DesignsPage', () => {
  it('mostra carregando e depois o vazio', async () => {
    const { container } = renderWithApp(newApi(), <DesignsPage />);
    expect(screen.getByRole('status')).toHaveTextContent('Carregando seus designs');
    expect(await screen.findByRole('heading', { name: 'Nenhum design salvo' })).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('lista nome, região, blocos e data na ordem da API, só como texto', async () => {
    const api = newApi();
    await seed(api, 'Loja v1', '<img src=x onerror=alert(1)>');
    const { container } = renderWithApp(api, <DesignsPage />);
    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row').slice(1);
    const names = (await api.designs.list()).map((d) => d.name);
    expect(rows.map((r) => within(r).getAllByRole('rowheader')[0]?.textContent)).toEqual(names);
    expect(within(rows[0]!).getByText('2 blocos')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('us-east-1')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('2 de 10 designs')).toBeInTheDocument();
    expect(rows[0]!.querySelector('time')).toHaveAttribute(
      'datetime',
      (await api.designs.list())[0]!.updatedAt,
    );
    expect(rows[0]!.querySelector('time')!.textContent).toMatch(
      /^\d{2}\/\d{2}\/\d{4}, \d{2}:\d{2}$/,
    );
    await expectNoAxeViolations(container);
  });

  it('abre o design: valida, põe na store, guarda o id e vai ao editor', async () => {
    const api = newApi();
    await seed(api, 'Loja v1');
    const user = userEvent.setup();
    const { router } = renderWithApp(api, <DesignsPage />);
    await user.click(await screen.findByRole('button', { name: 'Abrir Loja v1' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(designStore.getState().document.blocks).toHaveLength(2);
    expect(savedDesignStore.getState().saved).toMatchObject({ name: 'Loja v1', version: 1 });
  });

  it('abrir é um passo único e desfazível, que devolve o design de antes', async () => {
    const api = newApi();
    await seed(api, 'Loja v1');
    const user = userEvent.setup();
    const { router } = renderWithApp(api, <DesignsPage />);
    await user.click(await screen.findByRole('button', { name: 'Abrir Loja v1' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(designStore.getState().document.blocks).toHaveLength(2);
    expect(designStore.getState().undo()).toBe('replace-design');
    expect(designStore.getState().document).toEqual(EMPTY_STATE.document);
  });

  it('design que sumiu: mensagem própria e a lista se atualiza', async () => {
    const api = newApi();
    await seed(api, 'Loja v1');
    const user = userEvent.setup();
    renderWithApp(api, <DesignsPage />);
    const button = await screen.findByRole('button', { name: 'Abrir Loja v1' });
    const id = (await api.designs.list())[0]!.id;
    await api.designs.remove(id);
    await user.click(button);
    expect(await screen.findByRole('alert')).toHaveTextContent('não existe mais');
    expect(await screen.findByRole('heading', { name: 'Nenhum design salvo' })).toBeInTheDocument();
  });

  it('com alterações não salvas, confirma antes de abrir', async () => {
    const api = newApi();
    await seed(api, 'Loja v1');
    act(() => void designStore.getState().loadDesign(doc));
    act(() => void designStore.getState().setRegion('sa-east-1')); // alteração além do carregado
    const user = userEvent.setup();
    const { router } = renderWithApp(api, <DesignsPage />);
    await user.click(await screen.findByRole('button', { name: 'Abrir Loja v1' }));
    expect(screen.getByRole('dialog', { name: 'Abrir e descartar alterações?' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(savedDesignStore.getState().saved).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Abrir Loja v1' }));
    await user.click(screen.getByRole('button', { name: 'Abrir sem salvar' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(savedDesignStore.getState().saved).not.toBeNull();
  });

  it('não põe na store um documento que o schema recusa', async () => {
    const api = newApi();
    await seed(api, 'Loja v1');
    const get = api.designs.get;
    api.designs.get = async (id) => ({ ...(await get(id)), doc: { schemaVersion: 9 } as never });
    const user = userEvent.setup();
    renderWithApp(api, <DesignsPage />);
    await user.click(await screen.findByRole('button', { name: 'Abrir Loja v1' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('não conseguimos abrir');
    expect(designStore.getState().document).toEqual(EMPTY_STATE.document);
    expect(savedDesignStore.getState().saved).toBeNull();
  });

  it('erro de rede mostra frase própria e tenta de novo', async () => {
    const base = newApi();
    await seed(base, 'Loja v1');
    let up = false;
    const api: Api = {
      ...base,
      designs: {
        ...base.designs,
        list: () => (up ? base.designs.list() : failingApi('network').designs.list()),
      },
    };
    const user = userEvent.setup();
    const { container } = renderWithApp(api, <DesignsPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Sem conexão com o serviço');
    await expectNoAxeViolations(container);
    up = true;
    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByRole('table')).toBeInTheDocument();
  });

  it('anônimo vê o convite para entrar, com o ponto de encaixe do botão', async () => {
    const { container } = renderWithApp(
      failingApi('unauthenticated'),
      <DesignsPage signInAction={<button>Entrar</button>} />,
    );
    expect(
      await screen.findByRole('heading', { name: 'Entre para ver seus designs' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Entrar' })).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    await expectNoAxeViolations(container);
  });

  describe('gerenciar', () => {
    it('renomeia a partir da lista', async () => {
      const api = newApi();
      await seed(api, 'Loja v1');
      const user = userEvent.setup();
      renderWithApp(api, <DesignsPage />);
      await user.click(await screen.findByRole('button', { name: 'Renomear Loja v1' }));
      const dialog = screen.getByRole('dialog');
      const field = within(dialog).getByLabelText('Nome do design');
      await user.clear(field);
      await user.type(field, 'Loja v2');
      await user.click(within(dialog).getByRole('button', { name: 'Renomear' }));
      expect(await screen.findByRole('button', { name: 'Abrir Loja v2' })).toBeInTheDocument();
      expect((await api.designs.list())[0]!.name).toBe('Loja v2');
    });

    it('duplica com outro nome', async () => {
      const api = newApi();
      await seed(api, 'Loja v1');
      const user = userEvent.setup();
      renderWithApp(api, <DesignsPage />);
      await user.click(await screen.findByRole('button', { name: 'Duplicar Loja v1' }));
      await user.click(
        within(screen.getByRole('dialog')).getByRole('button', { name: 'Duplicar' }),
      );
      expect(
        await screen.findByRole('button', { name: 'Abrir Loja v1 (cópia)' }),
      ).toBeInTheDocument();
    });

    it('mostra mensagem clara ao duplicar no limite', async () => {
      const api = newApi(); // limite 2
      await seed(api, 'A', 'B');
      const user = userEvent.setup();
      renderWithApp(api, <DesignsPage />);
      await user.click(await screen.findByRole('button', { name: 'Duplicar A' }));
      await user.click(
        within(screen.getByRole('dialog')).getByRole('button', { name: 'Duplicar' }),
      );
      expect(await screen.findByRole('alert')).toHaveTextContent('limite de 10 designs');
      expect(await api.designs.list()).toHaveLength(2);
    });

    it('só apaga depois da confirmação', async () => {
      const api = newApi();
      await seed(api, 'Loja v1');
      const user = userEvent.setup();
      renderWithApp(api, <DesignsPage />);
      await user.click(await screen.findByRole('button', { name: 'Apagar Loja v1' }));
      await user.click(
        within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar' }),
      );
      expect(await api.designs.list()).toHaveLength(1);
      await user.click(screen.getByRole('button', { name: 'Apagar Loja v1' }));
      await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Apagar' }));
      expect(
        await screen.findByRole('heading', { name: 'Nenhum design salvo' }),
      ).toBeInTheDocument();
      expect(await api.designs.list()).toHaveLength(0);
    });
  });
});
