import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { designDocumentSchema } from '../../../shared/lib/design';
import { adrExampleDesign as fixture } from '../../../test/designFixtures';
import { announcerStore } from '../hooks/announcer';
import { designStore } from '../hooks/designStore';
import { EMPTY_STATE } from '../model/editorState';
import { EMPTY_HISTORY } from '../model/history';
import { BLOCK_DRAG_MIME } from '../model/palette';
import { CanvasPanel } from './CanvasPanel';

const doc = designDocumentSchema.parse(fixture);
const layout = {
  blk_fn_api: { x: 80, y: 80 },
  blk_assets: { x: 400, y: 80 },
  client: { x: 700, y: 80 },
};
const said = () => announcerStore.getState().message;
const where = (id: string) => designStore.getState().layout[id];

beforeEach(() => {
  designStore.setState({ ...EMPTY_STATE, document: doc, layout, history: EMPTY_HISTORY });
  announcerStore.setState({ message: '', seq: 0 });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <div style={{ width: 1000, height: 600 }}>
        <CanvasPanel />
      </div>
    </QueryClientProvider>,
  );
});
afterEach(() => designStore.setState({ ...EMPTY_STATE, history: EMPTY_HISTORY }));

const lambda = () => screen.findByLabelText(/^Lambda,/);

describe('canvas por teclado', () => {
  it('o bloco é focável (tabindex 0), Enter seleciona e o anúncio diz o serviço', async () => {
    const user = userEvent.setup();
    const node = await lambda();
    expect(node).toHaveAttribute('tabindex', '0');
    // O jsdom não mede os nós (ficam `visibility: hidden` para o user-event); o Tab real foi
    // conferido no navegador (checagem renderizada do PR).
    node.focus();
    expect(node).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(designStore.getState().selection).not.toBeNull();
    expect(said()).toMatch(/ selecionado$/);
  });

  it('Espaço seleciona; as setas movem 8 px, Shift move 32 px, e a sequência é um passo só', async () => {
    const node = await lambda();
    node.focus();
    fireEvent.keyDown(node, { key: ' ' });
    expect(designStore.getState().selection).toEqual({ kind: 'block', id: 'blk_fn_api' });
    expect(said()).toBe('Lambda selecionado');
    fireEvent.keyDown(node, { key: 'ArrowRight' });
    expect(where('blk_fn_api')).toEqual({ x: 88, y: 80 });
    fireEvent.keyDown(node, { key: 'ArrowRight', shiftKey: true });
    expect(where('blk_fn_api')).toEqual({ x: 120, y: 80 });
    fireEvent.keyDown(node, { key: 'ArrowDown' });
    expect(where('blk_fn_api')).toEqual({ x: 120, y: 88 });
    expect(designStore.getState().history.past).toHaveLength(1);
    act(() => void designStore.getState().undo());
    expect(where('blk_fn_api')).toEqual({ x: 80, y: 80 });
  });

  it('Delete remove o bloco (e é desfazível); o client nunca é removido', async () => {
    const user = userEvent.setup();
    const node = await lambda();
    node.focus();
    await user.keyboard('{Enter}{Delete}');
    expect(designStore.getState().document.blocks.map((b) => b.id)).toEqual(['blk_assets']);
    expect(said()).toBe('Bloco removido');
    act(() => void designStore.getState().undo());
    expect(designStore.getState().document.blocks).toHaveLength(2);

    const client = screen.getByLabelText(/^Internet/);
    client.focus();
    await user.keyboard('{Enter}{Delete}');
    expect(designStore.getState().document.blocks).toHaveLength(2);
  });

  it('Esc limpa a seleção e avisa', async () => {
    const node = await lambda();
    node.focus();
    fireEvent.keyDown(node, { key: 'Enter' });
    fireEvent.keyDown(node, { key: 'Escape' });
    expect(designStore.getState().selection).toBeNull();
    expect(said()).toBe('Seleção removida');
  });

  it('o aviso de "pode soltar" liga ao arrastar um bloco da paleta e desliga ao sair ou soltar', async () => {
    await lambda();
    const flow = document.querySelector('.react-flow')!;
    const canvas = flow.parentElement!;
    const over = { dataTransfer: { types: [BLOCK_DRAG_MIME], dropEffect: 'none' } };
    fireEvent.dragOver(flow, over);
    expect(canvas).toHaveAttribute('data-dropping', 'true');
    fireEvent.dragLeave(flow, { relatedTarget: document.body });
    expect(canvas).not.toHaveAttribute('data-dropping');
    fireEvent.dragOver(flow, over);
    fireEvent.drop(flow, { dataTransfer: { types: ['text/plain'], getData: () => '' } });
    expect(canvas).not.toHaveAttribute('data-dropping');
    fireEvent.dragOver(flow, { dataTransfer: { types: ['text/plain'] } });
    expect(canvas).not.toHaveAttribute('data-dropping'); // arrasto de outra coisa não acende
  });

  it('o texto de ajuda e o anúncio de movimento do React Flow estão em pt-BR', async () => {
    await lambda();
    expect(document.body).toHaveTextContent(/Enter ou Espaço seleciona o bloco/);
    expect(document.body).not.toHaveTextContent(/Press enter/);
  });
});
