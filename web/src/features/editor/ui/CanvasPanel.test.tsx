import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../../test/axe';
import { designDocumentSchema } from '../../../shared/lib/design';
import { adrExampleDesign as fixture } from '../../../test/designFixtures';
import { designStore } from '../hooks/designStore';
import { EMPTY_STATE } from '../model/editorState';
import { CanvasPanel } from './CanvasPanel';

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

  it('mostra o rótulo com marcação como texto, nunca como HTML', async () => {
    const { container } = renderCanvas(EVIL);
    const node = await screen.findByLabelText(new RegExp('^Lambda,'));
    expect(node).toHaveTextContent(EVIL);
    expect(container.querySelector('img')).toBeNull();
  });

  it('oferece zoom e ajustar à tela por botões nomeados', async () => {
    renderCanvas();
    for (const name of ['Aumentar o zoom', 'Diminuir o zoom', 'Ajustar à tela']) {
      expect(await screen.findByRole('button', { name })).toBeEnabled();
    }
  });

  it('com o design vazio, orienta e mantém só o client', async () => {
    designStore.setState(EMPTY_STATE);
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <CanvasPanel />
      </QueryClientProvider>,
    );
    expect(await screen.findByText(/Adicione um bloco pela paleta/)).toBeVisible();
    expect(container.querySelectorAll('.react-flow__node')).toHaveLength(1);
  });

  it('não tem violação de acessibilidade', async () => {
    const { container } = renderCanvas();
    await screen.findByLabelText(/^S3,/);
    await expectNoAxeViolations(container);
  });
});
