import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
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

  it('reage à store: mostra o custo no nó e o bloco que entra', async () => {
    const { container } = renderCanvas();
    expect(await screen.findByLabelText(/^S3,/)).toHaveTextContent('—');
    expect(container.querySelectorAll('.react-flow__node svg')).toHaveLength(3);
    const { document } = designStore.getState();
    const extra = { ...document.blocks[0]!, id: 'blk_extra', label: 'Outra' };
    act(() =>
      designStore.setState({ document: { ...document, blocks: [...document.blocks, extra] } }),
    );
    expect(await screen.findByLabelText(/^Lambda, Outra,/)).toBeInTheDocument();
  });

  it('mostra o ícone da categoria e o resumo "serviço · SKU" no nó', async () => {
    renderCanvas();
    const lambda = await screen.findByLabelText(/^Lambda, API handler/);
    expect(lambda.querySelector('svg')).toHaveAttribute('data-icon', 'compute');
    expect(lambda).toHaveTextContent(/Lambda · \S/);
    expect(screen.getByLabelText(/^S3, Uploads/).querySelector('svg')).toHaveAttribute(
      'data-icon',
      'data',
    );
    expect(screen.getByLabelText(/^Internet/).querySelector('svg')).toHaveAttribute(
      'data-icon',
      'globe',
    );
  });

  it('não tem violação de acessibilidade', async () => {
    const { container } = renderCanvas();
    await screen.findByLabelText(/^S3,/);
    await expectNoAxeViolations(container);
  });
});
