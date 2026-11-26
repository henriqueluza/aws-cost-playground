import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../../test/axe';
import { designDocumentSchema } from '../../../shared/lib/design';
import { adrExampleDesign as fixture } from '../../../test/designFixtures';
import { designStore } from '../hooks/designStore';
import { BLOCK_DRAG_MIME } from '../model/palette';
import { EMPTY_STATE } from '../model/editorState';
import { CanvasPanel } from './CanvasPanel';

// O jsdom não mede o canvas nem preenche as coordenadas do soltar: a conversão de tela para fluxo é fixa.
const zoom = vi.hoisted(() => ({ zoomIn: vi.fn(), zoomOut: vi.fn(), fitView: vi.fn() }));
vi.mock('@xyflow/react', async (importOriginal) => {
  const original = await importOriginal<typeof import('@xyflow/react')>();
  return {
    ...original,
    useReactFlow: () => ({
      ...original.useReactFlow(),
      ...zoom,
      screenToFlowPosition: () => ({ x: 120, y: 80 }),
    }),
  };
});

const adrExampleDesign = designDocumentSchema.parse(fixture);
const EVIL = '<img src=x onerror="alert(1)">';

function renderCanvas(label?: string) {
  const document = label
    ? { ...adrExampleDesign, blocks: [{ ...adrExampleDesign.blocks[0]!, label }], edges: [] }
    : adrExampleDesign;
  designStore.setState({ ...EMPTY_STATE, document });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <div style={{ width: 1000, height: 600 }}>
        <CanvasPanel />
      </div>
    </QueryClientProvider>,
  );
}

afterEach(() => designStore.setState(EMPTY_STATE));

describe('CanvasPanel', () => {
  it('desenha o client e os blocos do design, cada um com nome acessível', async () => {
    renderCanvas();
    expect(await screen.findByLabelText(/^Lambda, API handler, Computação/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^S3, Uploads, Dados/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Internet/)).toBeInTheDocument();
  });

  it('legenda dos tipos de conexão em texto, com o traçado de cada um', async () => {
    const { container } = renderCanvas();
    const legend = await screen.findByRole('region', { name: 'Legenda das conexões' });
    expect(within(legend).getByText('Dados')).toBeInTheDocument();
    expect(legend).toHaveTextContent('Executa em, tracejado');
    expect(legend).toHaveTextContent('Logs, pontilhado');
    expect(legend).toHaveTextContent('Dados, traço contínuo');
    expect(legend.querySelectorAll('svg path').length).toBe(6); // 3 amostras + 3 ícones, sem cor como único sinal
    await expectNoAxeViolations(container);
  });

  it('sem blocos não há legenda', () => {
    const { container } = renderCanvas();
    act(() => designStore.setState({ document: { ...adrExampleDesign, blocks: [], edges: [] } }));
    expect(container.querySelector('section[aria-label="Legenda das conexões"]')).toBeNull();
  });

  it('mostra o rótulo com marcação como texto, nunca como HTML', async () => {
    const { container } = renderCanvas(EVIL);
    const node = await screen.findByLabelText(new RegExp('^Lambda,'));
    expect(node).toHaveTextContent(EVIL);
    expect(container.querySelector('img')).toBeNull();
  });

  it('reage à store: mostra o custo no nó e o bloco que entra', async () => {
    const { container } = renderCanvas();
    expect(await screen.findByLabelText(/^S3,/)).toHaveTextContent('—');
    const icons = [...container.querySelectorAll<SVGElement>('.react-flow__node svg')];
    expect(icons.map((svg) => svg.dataset.icon).sort()).toEqual(['compute', 'data', 'globe']);
    expect(screen.getByLabelText(/^Lambda,/)).toHaveTextContent(/Lambda · \S/);
    const { document } = designStore.getState();
    const extra = { ...document.blocks[0]!, id: 'blk_extra', label: 'Outra' };
    act(() =>
      designStore.setState({ document: { ...document, blocks: [...document.blocks, extra] } }),
    );
    expect(await screen.findByLabelText(/^Lambda, Outra,/)).toBeInTheDocument();
  });

  // O d3-drag do React Flow lê `event.view`, que o user-event não preenche: o clique vai por fireEvent.
  it('selecionar o bloco chama a ação da store', async () => {
    renderCanvas();
    fireEvent.click(await screen.findByLabelText(/^S3,/));
    await waitFor(() =>
      expect(designStore.getState().selection).toEqual({ kind: 'block', id: 'blk_assets' }),
    );
  });

  it('Delete remove o bloco selecionado pela store e leva as arestas dele', async () => {
    renderCanvas();
    fireEvent.click(await screen.findByLabelText(/^S3,/));
    await userEvent.keyboard('{Delete}');
    await waitFor(() =>
      expect(designStore.getState().document.blocks.map((b) => b.id)).toEqual(['blk_fn_api']),
    );
    expect(designStore.getState().document.edges).toEqual([]);
  });

  it('o client não é removido nem é selecionável', async () => {
    renderCanvas();
    fireEvent.click(await screen.findByLabelText(/^Internet/));
    await userEvent.keyboard('{Delete}');
    expect(screen.getByLabelText(/^Internet/)).toBeInTheDocument();
    expect(designStore.getState().selection).toBeNull();
  });

  it('os botões de zoom e de ajustar chamam o React Flow', async () => {
    renderCanvas();
    const tools = await screen.findByRole('group', { name: 'Zoom do diagrama' });
    for (const [name, spy] of [
      ['Aumentar o zoom', zoom.zoomIn],
      ['Diminuir o zoom', zoom.zoomOut],
    ] as const) {
      fireEvent.click(within(tools).getByRole('button', { name }));
      expect(spy).toHaveBeenCalledTimes(1);
    }
    zoom.fitView.mockClear();
    fireEvent.click(within(tools).getByRole('button', { name: 'Ajustar à tela' }));
    expect(zoom.fitView).toHaveBeenCalledTimes(1);
  });

  it('com o design vazio, orienta e mantém só o client', async () => {
    designStore.setState(EMPTY_STATE);
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <CanvasPanel />
      </QueryClientProvider>,
    );
    expect(await screen.findByRole('heading', { name: 'Canvas vazio' })).toBeVisible();
    expect(container.querySelector('[aria-live=polite]')).toBeInTheDocument();
    expect(container.querySelectorAll('.react-flow__node')).toHaveLength(1);
  });

  describe('soltar bloco da paleta', () => {
    const drag = (types: string[], type = 'aws.sqs') => ({
      dataTransfer: { types, getData: () => type },
    });

    it('adiciona o bloco pela ação da store', async () => {
      const { container } = renderCanvas();
      await screen.findByLabelText(/^S3,/);
      const flow = container.querySelector('.react-flow')!;
      fireEvent.drop(flow, drag([BLOCK_DRAG_MIME]));
      const blocks = designStore.getState().document.blocks;
      expect(blocks.at(-1)?.type).toBe('aws.sqs');
      expect(designStore.getState().layout[blocks.at(-1)!.id]).toEqual({ x: 120, y: 80 });
    });

    it('ignora arrasto que não é da paleta e tipo fora do contrato', async () => {
      const { container } = renderCanvas();
      await screen.findByLabelText(/^S3,/);
      const flow = container.querySelector('.react-flow')!;
      fireEvent.drop(flow, drag(['text/plain']));
      fireEvent.drop(flow, drag([BLOCK_DRAG_MIME], 'aws.nao-existe'));
      expect(designStore.getState().document.blocks).toHaveLength(2);
    });
  });

  it('não tem violação de acessibilidade', async () => {
    const { container } = renderCanvas();
    await screen.findByLabelText(/^S3,/);
    await expectNoAxeViolations(container);
  });
});
