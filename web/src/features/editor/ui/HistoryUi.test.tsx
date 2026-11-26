import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../../test/axe';
import { Dialog } from '../../../shared/ui';
import { designStore } from '../hooks/designStore';
import { useHistoryShortcuts } from '../hooks/historyShortcuts';
import { EMPTY_STATE } from '../model/editorState';
import { EMPTY_HISTORY } from '../model/history';
import { HistoryButtons } from './HistoryButtons';
import { LiveAnnouncer } from './LiveAnnouncer';

function Harness({ dialog = false }: { dialog?: boolean }) {
  useHistoryShortcuts();
  return (
    <>
      <HistoryButtons />
      <LiveAnnouncer />
      <input aria-label="Buscar" />
      <Dialog open={dialog} onClose={() => {}} title="Aviso">
        <button type="button">Fechar</button>
      </Dialog>
    </>
  );
}

const region = () => designStore.getState().document.region;
const flip = () =>
  designStore.getState().setRegion(region() === 'us-east-1' ? 'sa-east-1' : 'us-east-1');
const settle = () => act(() => vi.advanceTimersByTimeAsync(100));

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  designStore.setState({ ...EMPTY_STATE, history: EMPTY_HISTORY });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('desfazer e refazer: botões, atalhos e anúncio', () => {
  it('os botões começam desligados, com nome e dica; ligam com o histórico e agem', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<Harness />);
    const undo = screen.getByRole('button', { name: 'Desfazer' });
    const redo = screen.getByRole('button', { name: 'Refazer' });
    expect(undo).toBeDisabled();
    expect(undo).toHaveAttribute('title', 'Nada para desfazer');
    expect(redo).toBeDisabled();
    act(() => void flip());
    expect(undo).toBeEnabled();
    expect(undo.title).toMatch(/Desfazer \(.*Z\)/);
    await user.click(undo);
    expect(region()).toBe('us-east-1');
    expect(redo).toBeEnabled();
    await user.click(redo);
    expect(region()).toBe('sa-east-1');
    await settle();
    expect(
      screen
        .getAllByRole('status')
        .map((n) => n.textContent)
        .join(''),
    ).toBe('Refeito: mudar região');
  });

  it('Ctrl+Z e Cmd+Z desfazem; Ctrl+Shift+Z, Cmd+Shift+Z e Ctrl+Y refazem; o anúncio nomeia a ação', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<Harness />);
    act(() => void flip());
    await user.keyboard('{Control>}z{/Control}');
    expect(region()).toBe('us-east-1');
    await settle();
    expect(
      screen
        .getAllByRole('status')
        .map((n) => n.textContent)
        .join(''),
    ).toBe('Desfeito: mudar região');
    await user.keyboard('{Control>}{Shift>}z{/Shift}{/Control}');
    expect(region()).toBe('sa-east-1');
    await user.keyboard('{Meta>}z{/Meta}');
    expect(region()).toBe('us-east-1');
    await user.keyboard('{Meta>}{Shift>}z{/Shift}{/Meta}');
    expect(region()).toBe('sa-east-1');
    await user.keyboard('{Control>}z{/Control}{Control>}y{/Control}');
    expect(region()).toBe('sa-east-1');
  });

  it('Ctrl+Z dentro de um campo de texto não desfaz o design', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<Harness />);
    act(() => void flip());
    await user.click(screen.getByLabelText('Buscar'));
    await user.keyboard('{Control>}z{/Control}');
    expect(region()).toBe('sa-east-1');
  });

  it('com um diálogo aberto, o atalho não age', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<Harness dialog />);
    act(() => void flip());
    await user.keyboard('{Control>}z{/Control}');
    expect(region()).toBe('sa-east-1');
  });

  it('sem nada a desfazer, o atalho avisa e não muda nada', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<Harness />);
    await user.keyboard('{Control>}z{/Control}');
    await settle();
    expect(
      screen
        .getAllByRole('status')
        .map((n) => n.textContent)
        .join(''),
    ).toBe('Nada para desfazer');
  });

  it('sem violações de acessibilidade', async () => {
    const { container } = render(<Harness />);
    await expectNoAxeViolations(container);
  });
});
