import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { adrExampleDesign } from '../../../test/designFixtures';
import { expectNoAxeViolations } from '../../../test/axe';
import { designStore, EMPTY_STATE } from '../../editor';
import type { DesignDocument } from '../../../shared/lib/design';
import { savedDesignStore } from '../hooks/savedDesignStore';
import { SaveControls } from './SaveControls';
import { failingApi, newApi, renderWithApp } from './testUtils';

const doc = adrExampleDesign as unknown as DesignDocument;
const load = (d: DesignDocument) => act(() => void designStore.getState().loadDesign(d));

afterEach(() => {
  designStore.setState(EMPTY_STATE);
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

  it('pede confirmação ao ir para Meus designs com alterações e deixa ficar', async () => {
    load(doc);
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

  it('sai sem perguntar quando não há nada a perder', async () => {
    const user = userEvent.setup();
    const { router } = renderWithApp(newApi(), <SaveControls />);
    await user.click(screen.getByRole('link', { name: 'Meus designs' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/designs'));
  });
});
