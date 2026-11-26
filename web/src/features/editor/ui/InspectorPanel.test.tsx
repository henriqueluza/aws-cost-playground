import { act, cleanup, render, screen, within } from '@testing-library/react';
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
    const requests = screen.getByLabelText('Requisições por mês');
    expect(requests).toHaveValue('3000000');
    expect(requests).toHaveAccessibleDescription('requisições');
    // origem: LLM, padrão e alterado à mão, cada uma em texto
    expect(screen.getByText(/estimado pela LLM/)).toBeInTheDocument();
    expect(screen.getByLabelText('Duração média')).toHaveValue('80');
    expect(screen.getByText(/alterado à mão/)).toBeInTheDocument();
  });

  it('valor ausente no design mostra o padrão do contrato com origem "padrão"', () => {
    select('blk_assets');
    render(<InspectorPanel />);
    expect(screen.getAllByText(/padrão/)).toHaveLength(3);
    expect(screen.getByLabelText('Armazenamento')).toHaveValue('50');
    expect(screen.queryByRole('button', { name: /Voltar/ })).toBeNull();
  });

  it('editar um valor válido grava em overrides e muda a origem', async () => {
    const user = userEvent.setup();
    select(FN);
    render(<InspectorPanel />);
    const field = screen.getByLabelText('Requisições por mês');
    await user.clear(field);
    await user.type(field, '4500000');
    expect(block().overrides).toEqual({ avgDurationMs: 80 }); // só grava ao sair do campo
    await user.keyboard('{Enter}');
    expect(block().overrides).toEqual({ avgDurationMs: 80, requestsPerMonth: 4500000 });
    expect(block().usage.values.requestsPerMonth).toBe(3000000);
    expect(
      screen.getByRole('button', { name: 'Voltar ao estimado: Requisições por mês' }),
    ).toBeInTheDocument();
  });

  it('valor fora da faixa: erro com faixa e unidade, anunciado, e nada vai para a store', async () => {
    const user = userEvent.setup();
    select(FN);
    render(<InspectorPanel />);
    const before = block().overrides;
    const field = screen.getByLabelText('Duração média');
    await user.clear(field);
    await user.type(field, '900001');
    await user.tab();
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Faixa permitida: 1 a 900.000 ms, número inteiro.');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field.getAttribute('aria-describedby')).toContain(alert.id);
    expect(block().overrides.avgDurationMs).toBe(80);
    expect(block().overrides).toEqual(before);
  });

  it.each(['1e9', '-5', '', '1.000', '12,5', 'abc'])('texto %j não chega à store', async (text) => {
    const user = userEvent.setup();
    select(FN);
    render(<InspectorPanel />);
    const field = screen.getByLabelText('Duração média');
    await user.clear(field);
    if (text) await user.type(field, text);
    await user.tab();
    expect(screen.getByRole('alert')).toHaveTextContent('Faixa permitida: 1 a 900.000 ms');
    expect(block().overrides.avgDurationMs).toBe(80);
  });

  it('vírgula decimal é aceita em campo fracionário', async () => {
    const user = userEvent.setup();
    select('blk_assets');
    render(<InspectorPanel />);
    const field = screen.getByLabelText('Armazenamento');
    await user.clear(field);
    await user.type(field, '12,5');
    await user.tab();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(block('blk_assets').overrides).toEqual({ storageGb: 12.5 });
  });

  it('voltar ao estimado remove só aquele override e devolve o foco ao campo', async () => {
    const user = userEvent.setup();
    designStore.setState({
      document: {
        ...doc,
        blocks: [
          { ...doc.blocks[0]!, overrides: { avgDurationMs: 80, requestsPerMonth: 5 } },
          doc.blocks[1]!,
        ],
      },
    });
    select(FN);
    render(<InspectorPanel />);
    await user.click(screen.getByRole('button', { name: 'Voltar ao estimado: Duração média' }));
    expect(block().overrides).toEqual({ requestsPerMonth: 5 });
    expect(screen.getByLabelText('Duração média')).toHaveFocus();
    expect(screen.getByLabelText('Duração média')).toHaveValue('120');
    expect(
      screen.getByRole('button', { name: /Voltar ao estimado: Requisições/ }),
    ).toBeInTheDocument();
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

  it('trocar o bloco selecionado descarta o rascunho inválido', async () => {
    const user = userEvent.setup();
    select(FN);
    render(<InspectorPanel />);
    const field = screen.getByLabelText('Duração média');
    await user.clear(field);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    await act(async () => select('blk_assets'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('sem violações de acessibilidade, com e sem erro', async () => {
    const user = userEvent.setup();
    select(FN);
    const { container } = render(<InspectorPanel />);
    await expectNoAxeViolations(container);
    await user.clear(screen.getByLabelText('Duração média'));
    await expectNoAxeViolations(container);
  });
});
