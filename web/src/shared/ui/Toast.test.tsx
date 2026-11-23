import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { parseCss, readRepoFile } from '../../test/css';
import { TOAST_CLOSE_LABEL, TOAST_DURATION_MS, ToastProvider, useToast } from './Toast';

const css = () => parseCss(readRepoFile('web/src/shared/ui/Toast.module.css'));
const status = () => screen.getByRole('status');
const box = () => status().parentElement as HTMLElement; // a caixa do toast
const closeButton = () => screen.queryByRole('button', { name: TOAST_CLOSE_LABEL });
// Margem contra o avanço real do relógio falso (`shouldAdvanceTime`) durante os eventos.
const EARLY = TOAST_DURATION_MS - 500;
const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

function Trigger({ message }: { message: string }) {
  const { show } = useToast();
  return (
    <button type="button" onClick={() => show(message)}>
      {`Mostrar ${message}`}
    </button>
  );
}

const renderToast = (...messages: string[]) =>
  render(
    <ToastProvider>
      {messages.map((m) => (
        <Trigger key={m} message={m} />
      ))}
    </ToastProvider>,
  );

it('useToast fora de um ToastProvider lança erro', () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  expect(() => render(<Trigger message="x" />)).toThrow(
    'useToast precisa estar dentro de um ToastProvider.',
  );
  vi.restoreAllMocks();
});

describe('ToastProvider', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  async function setup(...messages: string[]) {
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    renderToast(...(messages.length ? messages : ['Projeto salvo.']));
    const trigger = screen.getAllByRole('button')[0];
    await user.click(trigger);
    return { user, trigger };
  }

  it('renderiza os filhos e uma região de status vazia, sem botão de fechar', () => {
    renderToast('Projeto salvo.');
    expect(screen.getByRole('button', { name: 'Mostrar Projeto salvo.' })).toBeInTheDocument();
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(status()).toBeEmptyDOMElement();
    expect(box()).not.toHaveAttribute('data-open');
    expect(closeButton()).toBeNull();
  });

  it('show anuncia só o texto no status, com o fechar fora dele, e não rouba o foco', async () => {
    const { trigger } = await setup();
    expect(status().textContent).toBe('Projeto salvo.');
    expect(status().querySelector('button')).toBeNull();
    expect(box()).toHaveAttribute('data-open');
    expect(box()).toContainElement(closeButton());
    expect(status()).not.toContainElement(closeButton());
    expect(trigger).toHaveFocus();
  });

  it('mostra a mensagem como texto, nunca como HTML', async () => {
    await setup('<b>x</b>');
    expect(status().textContent).toBe('<b>x</b>');
    expect(document.body.querySelector('b')).toBeNull();
  });

  it('um toast por vez: o novo substitui o atual e reinicia o tempo', async () => {
    const { user } = await setup('Projeto salvo.', 'Link copiado.');
    wait(EARLY);
    await user.click(screen.getByRole('button', { name: 'Mostrar Link copiado.' }));
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(status().textContent).toBe('Link copiado.');
    expect(screen.getAllByRole('button', { name: TOAST_CLOSE_LABEL })).toHaveLength(1);
    wait(EARLY);
    expect(status().textContent).toBe('Link copiado.');
    wait(TOAST_DURATION_MS - EARLY);
    expect(status()).toBeEmptyDOMElement();
  });

  it('some sozinho depois de TOAST_DURATION_MS, sem mover o foco', async () => {
    const { trigger } = await setup();
    wait(EARLY);
    expect(status().textContent).toBe('Projeto salvo.');
    wait(TOAST_DURATION_MS - EARLY);
    expect(status()).toBeEmptyDOMElement();
    expect(box()).not.toHaveAttribute('data-open');
    expect(closeButton()).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('pausa com o ponteiro em cima; ao sair, o tempo reinicia inteiro', async () => {
    const { user } = await setup();
    wait(3000);
    await user.hover(box());
    wait(TOAST_DURATION_MS * 2);
    expect(status().textContent).toBe('Projeto salvo.');
    await user.unhover(box());
    wait(EARLY);
    expect(status().textContent).toBe('Projeto salvo.');
    wait(TOAST_DURATION_MS - EARLY);
    expect(status()).toBeEmptyDOMElement();
  });

  it('pausa com o foco dentro; ao sair, o tempo reinicia e fechar não move o foco', async () => {
    const { user, trigger } = await setup();
    wait(3000);
    await user.tab();
    expect(closeButton()).toHaveFocus();
    wait(TOAST_DURATION_MS * 2);
    expect(status().textContent).toBe('Projeto salvo.');
    await user.tab({ shift: true });
    expect(trigger).toHaveFocus();
    wait(EARLY);
    expect(status().textContent).toBe('Projeto salvo.');
    wait(TOAST_DURATION_MS - EARLY);
    expect(status()).toBeEmptyDOMElement();
    expect(trigger).toHaveFocus();
  });

  it('Esc com o foco dentro fecha e devolve o foco ao disparador', async () => {
    const { user, trigger } = await setup();
    await user.tab();
    expect(closeButton()).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(status()).toBeEmptyDOMElement();
    expect(trigger).toHaveFocus();
  });

  it('Esc com o foco fora do toast não fecha', async () => {
    const { user, trigger } = await setup();
    expect(trigger).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(status().textContent).toBe('Projeto salvo.');
  });

  it.each([
    ['Enter', (user: ReturnType<typeof userEvent.setup>) => user.keyboard('{Enter}')],
    ['clique', (user: ReturnType<typeof userEvent.setup>) => user.click(closeButton()!)],
  ])('%s no fechar fecha e devolve o foco ao disparador', async (_name, close) => {
    const { user, trigger } = await setup();
    await user.tab();
    await close(user);
    expect(status()).toBeEmptyDOMElement();
    expect(closeButton()).toBeNull();
    expect(trigger).toHaveFocus();
  });
});

it('não tem violações de acessibilidade, fechado e aberto', async () => {
  renderToast('Projeto salvo.');
  await expectNoAxeViolations(document.body);
  await userEvent.click(screen.getByRole('button', { name: 'Mostrar Projeto salvo.' }));
  expect(closeButton()).not.toBeNull();
  await expectNoAxeViolations(document.body);
});

describe('Toast.module.css', () => {
  it('flutua fixo no canto inferior esquerdo, com surface, raio de cartão e sombra', () => {
    expect(css()['.toast']).toMatchObject({
      position: 'fixed',
      'inset-inline-start': 'var(--space-4)',
      'inset-block-end': 'var(--space-4)',
      'background-color': 'var(--surface)',
      'border-radius': 'var(--radius-card)',
      'box-shadow': 'var(--shadow-float)',
    });
  });

  it('fechado é invisível; aberto entra só com opacity e transform em --t-ui e --ease-out', () => {
    expect(css()['.toast']).toMatchObject({ opacity: '0' });
    expect(css()['.toast[data-open]']).toMatchObject({
      opacity: '1',
      transition: 'opacity var(--t-ui) var(--ease-out), transform var(--t-ui) var(--ease-out)',
    });
  });

  it('no tema escuro sobe para --raised com borda --border', () => {
    expect(css()[":global(:root[data-theme='dark']) .toast"]).toMatchObject({
      'background-color': 'var(--raised)',
      'border-color': 'var(--border)',
    });
  });

  it('com prefers-reduced-motion: reduce, aparece sem transição', () => {
    expect(css()['@media (prefers-reduced-motion: reduce) .toast[data-open]']).toMatchObject({
      transition: 'none',
    });
  });

  it('só usa tokens e não mexe no contorno de foco do base.css', () => {
    for (const decls of Object.values(css())) {
      for (const [prop, value] of Object.entries(decls)) {
        expect(value).not.toMatch(/#|\d\s*px\b/);
        expect(prop).not.toMatch(/^outline/);
      }
    }
  });
});
