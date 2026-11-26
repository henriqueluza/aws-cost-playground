import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode, useState, type KeyboardEvent, type ReactNode } from 'react';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { parseCss, readRepoFile } from '../../test/css';
import { Button, Dialog, TextField } from './index';

const TITLE = 'Renomear projeto';
const css = () => parseCss(readRepoFile('web/src/shared/ui/Dialog.module.css'));
const button = (name: string) => screen.getByRole('button', { name });
const field = (name = 'Nome') => screen.getByRole('textbox', { name });
const expectClosed = () => {
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.body.childElementCount).toBe(1); // só o container do render: sem scrim
};
// Pedidos de fechar: o Esc (pelo Dialog) e o "Salvar". "Cancelar" fecha direto, sem passar aqui.
const onClose = vi.fn();
afterEach(() => onClose.mockReset());

function Page({ content }: { content?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const requestClose = () => {
    onClose();
    setOpen(false);
  };
  return (
    <>
      <Button>Antes</Button>
      <Button onClick={() => setOpen(true)}>Abrir</Button>
      <Button>Depois</Button>
      <Dialog open={open} onClose={requestClose} title={TITLE}>
        {content ?? (
          <>
            <TextField label="Nome" />
            <Button onClick={() => setOpen(false)}>Cancelar</Button>
            <Button variant="primary" onClick={requestClose}>
              Salvar
            </Button>
          </>
        )}
      </Dialog>
    </>
  );
}

async function open(content?: ReactNode, strict = false) {
  const user = userEvent.setup();
  const page = <Page content={content} />;
  render(strict ? <StrictMode>{page}</StrictMode> : page);
  const [before, trigger, after] = [button('Antes'), button('Abrir'), button('Depois')];
  await user.click(trigger);
  return { user, before, trigger, after, dialog: screen.getByRole('dialog', { name: TITLE }) };
}

describe('Dialog', () => {
  it('fechado não renderiza nada; aberto é modal, fora do container e rotulado pelo h2', async () => {
    const { container } = render(<Page />);
    expectClosed();
    await userEvent.click(button('Abrir'));
    const dialog = screen.getByRole('dialog', { name: TITLE });
    const title = within(dialog).getByRole('heading', { level: 2, name: TITLE });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', title.id);
    expect(container).not.toContainElement(dialog);
    expect(dialog.parentElement?.parentElement).toBe(document.body); // o scrim, filho do body
  });

  it('abre no primeiro controle; Tab e Shift+Tab circulam sem sair, inclusive do diálogo', async () => {
    const { user, dialog } = await open();
    const [name, cancel, save] = [field(), button('Cancelar'), button('Salvar')];
    expect(name).toHaveFocus();
    for (const next of [cancel, save, name, cancel]) {
      await user.tab(); // N + 1 Tabs: dá a volta e segue na ordem nativa
      expect(next).toHaveFocus();
    }
    for (const previous of [name, save, cancel]) {
      await user.tab({ shift: true });
      expect(previous).toHaveFocus();
    }
    dialog.focus();
    await user.tab({ shift: true });
    expect(save).toHaveFocus();
  });

  it('sem controles, o foco fica no próprio diálogo com Tab e Shift+Tab; Esc fecha', async () => {
    const { user, trigger, dialog } = await open(<p>Nada a fazer aqui.</p>);
    expect(dialog).toHaveFocus();
    await user.tab();
    expect(dialog).toHaveFocus();
    await user.tab({ shift: true });
    expect(dialog).toHaveFocus();
    await user.keyboard('{Escape}');
    expectClosed();
    expect(trigger).toHaveFocus();
  });

  it('foco levado para fora por código volta ao primeiro controle', async () => {
    const { before, after } = await open();
    for (const outside of [before, after]) {
      button('Salvar').focus();
      outside.focus();
      await waitFor(() => expect(field()).toHaveFocus());
    }
  });

  it.each(['{Escape}', '{Tab}{Enter}'])('%s fecha e devolve o foco ao disparador', async (keys) => {
    const { user, trigger } = await open();
    await user.keyboard(keys); // Esc, ou Enter no "Cancelar"
    expectClosed();
    expect(trigger).toHaveFocus();
  });

  it('em StrictMode e com um filho autoFocus, abre no primeiro controle e devolve o foco', async () => {
    const content = (
      <>
        <Button>Cancelar</Button>
        <TextField label="Nome" autoFocus />
      </>
    );
    const { user, trigger } = await open(content, true);
    expect(button('Cancelar')).toHaveFocus();
    await user.keyboard('{Escape}');
    expectClosed();
    expect(trigger).toHaveFocus();
  });

  it.each(['{Escape}', '{Tab}{Tab}{Enter}'])(
    '%s: não rouba o foco que a feature moveu',
    async (keys) => {
      const { user, after } = await open();
      onClose.mockImplementation(() => after.focus()); // a feature leva o foco para fora e fecha
      await user.keyboard(keys); // Esc, ou Enter no "Salvar"
      expectClosed();
      expect(after).toHaveFocus();
    },
  );

  it('Esc fecha uma vez, mesmo do body, e nenhuma tecla do diálogo chega ao document', async () => {
    const onDocumentKey = vi.fn();
    document.addEventListener('keydown', onDocumentKey);
    onTestFinished(() => document.removeEventListener('keydown', onDocumentKey));
    const { user } = await open();
    fireEvent.keyDown(field(), { key: 'Escape', isComposing: true }); // o IME encerra a composição
    expect(onClose).not.toHaveBeenCalled();
    await user.keyboard('a{Backspace}{Delete}{Tab}{Shift>}{Tab}{/Shift}');
    field().blur(); // como um controle focado que sai da página: o foco cai no body
    await user.keyboard('{Backspace}{Escape}'); // do body, a tecla também não passa
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onDocumentKey).not.toHaveBeenCalled();
    await user.keyboard('{Backspace}'); // fechado, a tecla volta a chegar ao document
    expect(onDocumentKey).toHaveBeenCalledTimes(1);
  });

  it('Esc já tratado por um filho (preventDefault) não chama onClose', async () => {
    const swallowEscape = (event: KeyboardEvent) =>
      event.key === 'Escape' && event.preventDefault();
    const { user } = await open(<TextField label="Busca" onKeyDown={swallowEscape} />);
    expect(field('Busca')).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('o scrim não fecha nem tira o foco do diálogo', async () => {
    const { user, dialog } = await open();
    const scrim = dialog.parentElement as HTMLElement;
    expect(fireEvent.mouseDown(scrim)).toBe(false);
    expect(fireEvent.mouseDown(field())).toBe(true); // dentro do diálogo, o clique segue normal
    await user.click(scrim);
    expect(onClose).not.toHaveBeenCalled();
    expect(field()).toHaveFocus();
  });
});

it('não tem violações de acessibilidade, fechado e aberto', async () => {
  render(<Page />);
  await expectNoAxeViolations(document.body);
  await userEvent.click(button('Abrir'));
  expect(screen.getByRole('dialog', { name: TITLE })).toBeInTheDocument();
  await expectNoAxeViolations(document.body);
});

describe('Dialog.module.css', () => {
  it('scrim fixo em --scrim; caixa surface com raio de cartão e sombra, entrando em --t-ui', () => {
    const decls = css();
    expect(decls['.scrim']).toMatchObject({ position: 'fixed', inset: '0' });
    expect(decls['.scrim']).toMatchObject({ 'background-color': 'var(--scrim)' });
    expect(decls['.dialog']).toMatchObject({
      'background-color': 'var(--surface)',
      'border-radius': 'var(--radius-card)',
      'box-shadow': 'var(--shadow-float)',
      padding: 'var(--card-pad)',
    });
    expect(decls['.dialog']?.animation).toMatch(/var\(--t-ui\).*var\(--ease-out\)/);
  });

  it('no escuro sobe para --raised com borda --border; com reduced-motion, nada anima', () => {
    const decls = css();
    expect(decls[":global(:root[data-theme='dark']) .dialog"]).toMatchObject({
      'background-color': 'var(--raised)',
      'border-color': 'var(--border)',
    });
    const reduced = decls['@media (prefers-reduced-motion: reduce) .scrim, .dialog'];
    expect(reduced).toMatchObject({ animation: 'none' });
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
