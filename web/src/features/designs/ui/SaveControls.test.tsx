import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { adrExampleDesign } from '../../../test/designFixtures';
import { expectNoAxeViolations } from '../../../test/axe';
import { designStore, EMPTY_STATE } from '../../editor';
import type { DesignDocument } from '../../../shared/lib/design';
import { ApiError } from '../../../shared/lib/api';
import { savedDesignStore } from '../hooks/savedDesignStore';
import { SaveControls } from './SaveControls';
import { failingApi, newApi, renderWithApp } from './testUtils';

const doc = adrExampleDesign as unknown as DesignDocument;
const load = (d: DesignDocument) => act(() => void designStore.getState().loadDesign(d));

afterEach(() => {
  designStore.setState({ ...EMPTY_STATE, baseline: EMPTY_STATE.document });
  savedDesignStore.setState({ saved: null, saving: false, error: null });
});

describe('SaveControls', () => {
  it('cria no primeiro salvamento, pede o nome e passa por salvando até salvo', async () => {
    const api = newApi();
    load(doc);
    const user = userEvent.setup();
    const { container } = renderWithApp(api, <SaveControls />);
    expect(screen.getByRole('status')).toHaveTextContent('Não salvo');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await user.clear(screen.getByLabelText('Nome do design'));
    await user.type(screen.getByLabelText('Nome do design'), 'Loja v2');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Salvo'));
    expect(screen.getByText('Loja v2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled();
    expect((await api.designs.list()).map((d) => d.name)).toEqual(['Loja v2']);
    await expectNoAxeViolations(container);
  });

  it('atualiza (não cria outro) e mostra alterações não salvas ao editar', async () => {
    const api = newApi();
    load(doc);
    const user = userEvent.setup();
    renderWithApp(api, <SaveControls />);
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Salvo'));
    act(() => void designStore.getState().setRegion('sa-east-1'));
    expect(screen.getByRole('status')).toHaveTextContent('Alterações não salvas');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Salvo'));
    const list = await api.designs.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ version: 2, region: 'sa-east-1' });
  });

  it('não salva duas vezes ao mesmo tempo', async () => {
    const api = newApi();
    let creates = 0;
    const create = api.designs.create;
    api.designs.create = async (i) => (creates++, create(i));
    load(doc);
    renderWithApp(api, <SaveControls />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Salvar' }));
    expect(savedDesignStore.getState().begin()).toBe(true); // reserva manual
    expect(savedDesignStore.getState().begin()).toBe(false); // segunda é recusada
    savedDesignStore.getState().clearError();
    savedDesignStore.setState({ saving: false });
    await waitFor(() => expect(creates).toBe(1));
  });

  it.each([
    ['design-limit', 'Você atingiu o limite de 50 designs.'],
    ['too-large', /grande demais/],
    ['unauthenticated', /Entre na sua conta/],
    ['version-conflict', /Nada foi sobrescrito/],
    ['network', /Sem conexão/],
  ] as const)('erro %s vira texto próprio', async (kind, text) => {
    load(doc);
    renderWithApp(failingApi(kind), <SaveControls />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(text);
    expect(screen.getByRole('status')).toHaveTextContent('Não salvo');
    expect(screen.queryByRole('button', { name: 'Tentar de novo' }) !== null).toBe(
      kind === 'network',
    );
  });

  it('mostra Salvando… e trava o botão enquanto o servidor não responde', async () => {
    const api = newApi();
    let release = () => {};
    const create = api.designs.create;
    api.designs.create = async (input) => {
      await new Promise<void>((resolve) => (release = resolve));
      return create(input);
    };
    load(doc);
    const user = userEvent.setup();
    renderWithApp(api, <SaveControls />);
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByRole('button', { name: 'Salvando…' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Salvando…');
    // edição durante o salvamento: depois de salvo, o que mudou continua pendente
    act(() => void designStore.getState().setRegion('sa-east-1'));
    await act(async () => release());
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Alterações não salvas'),
    );
  });

  it('Tentar de novo reenvia com o nome digitado e oferece o botão Entrar sem sessão', async () => {
    const base = newApi();
    let calls = 0;
    const names: string[] = [];
    const api = {
      ...base,
      designs: {
        ...base.designs,
        create: async (input: Parameters<typeof base.designs.create>[0]) => {
          names.push(input.name);
          if (calls++ === 0) throw new ApiError({ kind: 'network' });
          return base.designs.create(input);
        },
      },
    };
    load(doc);
    const user = userEvent.setup();
    renderWithApp(api, <SaveControls />);
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await user.clear(screen.getByLabelText('Nome do design'));
    await user.type(screen.getByLabelText('Nome do design'), 'Loja v2');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Salvar' }));
    await user.click(await screen.findByRole('button', { name: 'Tentar de novo' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Salvo'));
    expect(names).toEqual(['Loja v2', 'Loja v2']);
  });

  it('sem sessão, o aviso oferece o ponto de encaixe do Entrar', async () => {
    load(doc);
    const user = userEvent.setup();
    renderWithApp(
      failingApi('unauthenticated'),
      <SaveControls signInAction={<button>Entrar</button>} />,
    );
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByRole('button', { name: 'Entrar' })).toBeInTheDocument();
  });

  it('pede confirmação ao ir para Meus designs com alterações e deixa ficar', async () => {
    load(doc);
    act(() => void designStore.getState().setRegion('sa-east-1')); // alteração além do carregado
    const user = userEvent.setup();
    const { router } = renderWithApp(newApi(), <SaveControls />);
    await user.click(screen.getByRole('link', { name: 'Meus designs' }));
    expect(await screen.findByRole('dialog', { name: 'Sair sem salvar?' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continuar editando' }));
    expect(router.state.location.pathname).toBe('/');
    await user.click(screen.getByRole('link', { name: 'Meus designs' }));
    await user.click(await screen.findByRole('button', { name: 'Sair sem salvar' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/designs'));
  });

  it('vai para a comparação (só leitura) sem perguntar, mesmo com alterações', async () => {
    load(doc);
    const { router } = renderWithApp(newApi(), <SaveControls />);
    await act(() => router.navigate('/comparar'));
    expect(router.state.location.pathname).toBe('/comparar');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(designStore.getState().document).toEqual(doc);
  });

  it('sai sem perguntar quando não há nada a perder', async () => {
    const user = userEvent.setup();
    const { router } = renderWithApp(newApi(), <SaveControls />);
    await user.click(screen.getByRole('link', { name: 'Meus designs' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/designs'));
  });

  describe('conflito de versão', () => {
    const conflict = async () => {
      const api = newApi();
      load(doc);
      const user = userEvent.setup();
      renderWithApp(api, <SaveControls />);
      await user.click(screen.getByRole('button', { name: 'Salvar' }));
      await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Salvar' }));
      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Salvo'));
      const id = savedDesignStore.getState().saved!.id;
      await api.designs.update(id, { expectedVersion: 1, name: 'Outro lugar' }); // outra aba
      act(() => void designStore.getState().setRegion('sa-east-1'));
      await user.click(screen.getByRole('button', { name: 'Salvar' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Nada foi sobrescrito');
      return { api, user, id };
    };

    it('avisa e oferece recarregar ou salvar como cópia, sem sobrescrever', async () => {
      const { api, id } = await conflict();
      expect(screen.getByRole('button', { name: 'Recarregar versão salva' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Salvar como cópia' })).toBeInTheDocument();
      expect((await api.designs.get(id)).doc.region).toBe(doc.region);
    });

    it('salva como cópia: cria outro design e deixa o original intacto', async () => {
      const { api, user, id } = await conflict();
      await user.click(screen.getByRole('button', { name: 'Salvar como cópia' }));
      await waitFor(() => expect(savedDesignStore.getState().saved?.id).not.toBe(id));
      const list = await api.designs.list();
      expect(list).toHaveLength(2);
      expect(list.find((d) => d.id === id)).toMatchObject({ name: 'Outro lugar', version: 2 });
      expect(list.find((d) => d.id !== id)?.region).toBe('sa-east-1');
    });

    it('recarrega a versão salva e descarta a edição local', async () => {
      const { user, id } = await conflict();
      await user.click(screen.getByRole('button', { name: 'Recarregar versão salva' }));
      await waitFor(() => expect(savedDesignStore.getState().saved?.version).toBe(2));
      expect(savedDesignStore.getState().saved).toMatchObject({ id, name: 'Outro lugar' });
      expect(designStore.getState().document.region).toBe(doc.region);
    });
  });
});
