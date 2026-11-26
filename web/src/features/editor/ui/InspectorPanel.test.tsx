import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../../test/axe';
import { adrExampleDesign } from '../../../test/designFixtures';
import { designStore } from '../hooks/designStore';
import { EMPTY_STATE } from '../model/editorState';
import { InspectorPanel } from './InspectorPanel';

const FN = 'blk_fn_api';
const doc = structuredClone(adrExampleDesign) as unknown as typeof EMPTY_STATE.document;

const block = (id = FN) => designStore.getState().document.blocks.find((b) => b.id === id)!;
const select = (id: string | null) => {
  expect(designStore.getState().select(id === null ? null : { kind: 'block', id }).ok).toBe(true);
};

beforeEach(() => {
  designStore.setState({ ...EMPTY_STATE, document: doc });
});
afterEach(cleanup);

describe('InspectorPanel', () => {
  it('sem seleção mostra o estado vazio', () => {
    render(<InspectorPanel />);
    expect(screen.getByRole('heading', { name: 'Nenhum bloco selecionado' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('aresta selecionada: aviso, sem formulário', () => {
    designStore.getState().select({ kind: 'edge', id: 'edg_1' });
    render(<InspectorPanel />);
    expect(screen.getByRole('heading', { name: 'Aresta selecionada' })).toBeInTheDocument();
  });

  it('bloco de tipo fora do contrato não monta formulário', () => {
    designStore.setState({
      document: { ...doc, blocks: [{ ...doc.blocks[0]!, type: 'aws.nope' }] },
      selection: { kind: 'block', id: FN },
    });
    render(<InspectorPanel />);
    expect(screen.getByRole('heading', { name: 'Tipo de bloco desconhecido' })).toBeInTheDocument();
  });

  it('mostra atributos, valores, unidades e a origem em texto', () => {
    select(FN);
    render(<InspectorPanel />);
    expect(screen.getByRole('heading', { name: 'Lambda' })).toBeInTheDocument();
    expect(screen.getByLabelText('Nome do bloco')).toHaveValue('API handler');
    expect(screen.getByLabelText('Memória')).toHaveValue('512');
    expect(screen.getByLabelText('Arquitetura')).toHaveValue('arm64');
    expect(screen.getByText('Requisições por mês').nextElementSibling).toHaveTextContent(
      /3\.000\.000.*requisições/,
    );
    // origem: LLM, padrão e alterado à mão, cada uma em texto
    expect(screen.getByText(/estimado pela LLM/)).toBeInTheDocument();
    expect(screen.getByText('Duração média').nextElementSibling).toHaveTextContent(/80.*ms/);
    expect(screen.getByText(/alterado à mão/)).toBeInTheDocument();
  });

  it('valor ausente no design mostra o padrão do contrato com origem "padrão"', () => {
    select('blk_assets');
    render(<InspectorPanel />);
    expect(screen.getAllByText(/padrão/)).toHaveLength(3);
    expect(screen.getByText('Armazenamento').nextElementSibling).toHaveTextContent(/50.*GB/);
  });

  it('atributo é seleção do conjunto fechado e grava o tipo do contrato', async () => {
    const user = userEvent.setup();
    select(FN);
    render(<InspectorPanel />);
    const memory = screen.getByLabelText('Memória');
    expect(within(memory).getAllByRole('option')).toHaveLength(8);
    await user.selectOptions(memory, '1024');
    expect(block().attributes).toEqual({ memoryMb: 1024, architecture: 'arm64' });
  });

  it('atributo opcional (zona) pode ficar sem valor', async () => {
    const user = userEvent.setup();
    designStore.setState({
      document: {
        ...doc,
        edges: [],
        blocks: [{ ...doc.blocks[0]!, id: 'blk_vm', type: 'aws.ec2', attributes: { az: 'a' } }],
      },
    });
    select('blk_vm');
    render(<InspectorPanel />);
    const az = screen.getByLabelText('Zona de disponibilidade');
    expect(az).toHaveValue('a');
    await user.selectOptions(az, 'Não definida');
    expect(block('blk_vm').attributes).toEqual({});
  });

  it('rótulo: grava, é texto puro e recusa o que passa do limite ou tem controle', async () => {
    const user = userEvent.setup();
    select(FN);
    render(<InspectorPanel />);
    const label = screen.getByLabelText('Nome do bloco');
    await user.clear(label);
    await user.type(label, '<img src=x onerror=alert(1)>');
    expect(block().label).toBe('<img src=x onerror=alert(1)>');
    expect(document.querySelector('img')).toBeNull();

    await user.clear(label);
    await user.click(label);
    await user.paste('a'.repeat(81));
    expect(screen.getByRole('alert')).toHaveTextContent('Use até 80 caracteres (tem 81).');
    expect(block().label).toBe('');

    await user.clear(label);
    await user.paste('a‮b');
    expect(screen.getByRole('alert')).toHaveTextContent('caracteres de controle');
    expect(block().label).toBe('');
  });

  it('sem violações de acessibilidade, com e sem erro', async () => {
    const user = userEvent.setup();
    select(FN);
    const { container } = render(<InspectorPanel />);
    await expectNoAxeViolations(container);
    await user.type(screen.getByLabelText('Nome do bloco'), 'x'.repeat(80));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });
});
