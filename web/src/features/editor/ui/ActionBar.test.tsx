import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../../test/axe';
import { usePriceCatalog } from '../../pricing';
import { designStore } from '../hooks/designStore';
import { useDesignStore } from '../hooks/useDesignStore';
import { referenceDesign, referenceLayout } from '../model/template/referenceTemplate';
import { ActionBar } from './ActionBar';

const template = () => ({
  document: referenceDesign(),
  layout: referenceLayout(),
  selection: null,
});

beforeEach(() => {
  const document = referenceDesign();
  designStore.setState({ ...template(), document, baseline: document });
});
afterEach(() => vi.unstubAllGlobals());

function Harness() {
  const design = useDesignStore((s) => s.document);
  const state = usePriceCatalog(design);
  return (
    <header>
      <ActionBar />
      <p>{state.status}</p>
    </header>
  );
}

function renderBar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );
  return { ...view, client };
}

describe('seletor de região', () => {
  it('oferece só as regiões do contrato e mostra a do design', () => {
    renderBar();
    const select = screen.getByRole('combobox', { name: 'Região' });
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.getAttribute('value')),
    ).toEqual(['us-east-1', 'sa-east-1']);
    expect(select).toHaveValue('us-east-1');
  });

  it('troca só a região do design e faz o catálogo recarregar para a nova região', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('{}', { status: 404 }))),
    );
    const { client } = renderBar();
    const regionsQueried = () =>
      client
        .getQueryCache()
        .findAll({ queryKey: ['pricing', 'catalog'] })
        .map((query) => query.queryKey[2]);
    await waitFor(() => expect(regionsQueried()).toEqual(['us-east-1']));
    const before = designStore.getState().document;
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Região' }), 'sa-east-1');
    expect(designStore.getState().document).toEqual({ ...before, region: 'sa-east-1' });
    await waitFor(() => expect(regionsQueried()).toContain('sa-east-1'));
  });
});

describe('Novo design', () => {
  it('sem alteração pendente, cria direto, sem diálogo', async () => {
    renderBar();
    await userEvent.click(screen.getByRole('button', { name: 'Novo design' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Novo design criado a partir do template.',
    );
  });

  it('com alteração pendente, pede confirmação e Cancelar mantém o design', async () => {
    const user = userEvent.setup();
    renderBar();
    designStore.getState().removeBlock(designStore.getState().document.blocks[0]!.id);
    const edited = designStore.getState().document;
    await user.click(screen.getByRole('button', { name: 'Novo design' }));
    const dialog = await screen.findByRole('dialog', { name: 'Descartar as alterações?' });
    expect(within(dialog).getByRole('button', { name: 'Cancelar' })).toHaveFocus();
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(designStore.getState().document).toBe(edited);
  });

  it('com alteração pendente, confirmar volta ao template limpo', async () => {
    const user = userEvent.setup();
    renderBar();
    designStore.getState().setRegion('sa-east-1');
    await user.click(screen.getByRole('button', { name: 'Novo design' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: 'Descartar e criar novo',
      }),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    const { document, baseline } = designStore.getState();
    expect(document).toEqual(referenceDesign());
    expect(baseline).toBe(document);
  });

  it('Esc fecha o diálogo sem descartar', async () => {
    const user = userEvent.setup();
    renderBar();
    designStore.getState().setRegion('sa-east-1');
    await user.click(screen.getByRole('button', { name: 'Novo design' }));
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(designStore.getState().document.region).toBe('sa-east-1');
  });

  it('trocar a região e voltar à original não conta como alteração', async () => {
    renderBar();
    designStore.getState().setRegion('sa-east-1');
    designStore.getState().setRegion('us-east-1');
    await userEvent.click(screen.getByRole('button', { name: 'Novo design' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('aviso ao fechar a aba', () => {
  it('só impede o fechamento com alteração pendente', () => {
    renderBar();
    const close = () => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(close()).toBe(false);
    act(() => void designStore.getState().setRegion('sa-east-1'));
    expect(close()).toBe(true);
    act(() => void designStore.getState().setRegion('us-east-1'));
    expect(close()).toBe(false);
  });
});

describe('acessibilidade', () => {
  it('a barra e o diálogo não têm violações no axe', async () => {
    const { container } = renderBar();
    await expectNoAxeViolations(container);
    designStore.getState().setRegion('sa-east-1');
    await userEvent.click(screen.getByRole('button', { name: 'Novo design' }));
    await screen.findByRole('dialog');
    await expectNoAxeViolations(document.body);
  });
});
