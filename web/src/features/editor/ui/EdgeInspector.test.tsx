import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../../test/axe';
import { designDocumentSchema, type DesignDocument } from '../../../shared/lib/design';
import { adrExampleDesign } from '../../../test/designFixtures';
import { announcerStore } from '../hooks/announcer';
import { designStore } from '../hooks/designStore';
import { EMPTY_STATE } from '../model/editorState';
import { EMPTY_HISTORY } from '../model/history';
import { InspectorPanel } from './InspectorPanel';

const base = designDocumentSchema.parse(adrExampleDesign);
const [lambda, s3] = base.blocks as [
  DesignDocument['blocks'][number],
  DesignDocument['blocks'][number],
];
const EVIL = '<img src=x onerror="alert(1)">';
const ecs = { ...s3, id: 'blk_ecs', type: 'aws.ecs', label: 'Cluster', attributes: {} };
const ec2 = { ...s3, id: 'blk_ec2', type: 'aws.ec2', label: EVIL, attributes: {} };
const logs = { ...s3, id: 'blk_logs', type: 'aws.cloudwatch', label: 'Logs', attributes: {} };
const edgeOf = (id: string, source: string, target: string, kind: 'data' | 'runs-on' | 'logs') => ({
  ...base.edges[0]!,
  id,
  source,
  target,
  kind,
  usage: {
    source: 'default' as const,
    values: (kind === 'runs-on' ? {} : { gbPerMonth: 40 }) as Record<string, number>,
  },
});
const doc: DesignDocument = {
  ...base,
  blocks: [lambda, s3, ecs, ec2, logs],
  edges: [
    base.edges[0]!,
    edgeOf('edg_host', 'blk_ecs', 'blk_ec2', 'runs-on'),
    edgeOf('edg_log', 'blk_fn_api', 'blk_logs', 'logs'),
  ],
};
const edge = (id: string) => designStore.getState().document.edges.find((e) => e.id === id)!;
const open = (id: string) => {
  designStore.getState().select({ kind: 'edge', id });
  return render(<InspectorPanel />);
};

beforeEach(() => designStore.setState({ ...EMPTY_STATE, document: doc, history: EMPTY_HISTORY }));
afterEach(cleanup);

describe('EdgeInspector', () => {
  it('mostra as duas pontas (rótulo como texto), o tipo e a origem do volume', async () => {
    const { container } = open('edg_1');
    expect(screen.getByRole('heading', { name: 'Conexão' })).toBeInTheDocument();
    const ends = screen.getByText('De').parentElement!;
    expect(ends).toHaveTextContent('S3, Uploads');
    expect(screen.getByText('Para').parentElement).toHaveTextContent('Internet');
    expect(screen.getByLabelText('Tipo da conexão')).toHaveValue('data');
    expect(screen.getByLabelText('Volume de dados por mês')).toHaveValue('120');
    expect(screen.getByText(/estimado pela LLM/)).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
    await expectNoAxeViolations(container);
  });

  it('rótulo com marcação aparece como texto', () => {
    const { container } = open('edg_host');
    expect(container).toHaveTextContent(EVIL);
    expect(container.querySelector('img')).toBeNull();
  });

  it('edita gbPerMonth ao sair do campo, vira "alterado à mão" e volta ao estimado', async () => {
    const user = userEvent.setup();
    open('edg_1');
    const field = screen.getByLabelText('Volume de dados por mês');
    await user.clear(field);
    await user.type(field, '250,5');
    await user.tab();
    expect(edge('edg_1').overrides).toEqual({ gbPerMonth: 250.5 });
    expect(edge('edg_1').usage.values.gbPerMonth).toBe(120);
    expect(screen.getByText(/alterado à mão/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Voltar ao estimado/ }));
    expect(edge('edg_1').overrides).toEqual({});
    expect(screen.getByLabelText('Volume de dados por mês')).toHaveValue('120');
  });

  it('valor inválido mostra a faixa e não chega à store', async () => {
    const user = userEvent.setup();
    open('edg_1');
    const field = screen.getByLabelText('Volume de dados por mês');
    await user.clear(field);
    await user.type(field, '1e9');
    await user.tab();
    expect(screen.getByRole('alert')).toHaveTextContent(/Faixa permitida/);
    expect(edge('edg_1').overrides).toEqual({});
  });

  it('par com um só tipo: seleção travada com explicação', () => {
    open('edg_log');
    const select = screen.getByLabelText('Tipo da conexão');
    expect(select).toBeDisabled();
    expect(screen.getByText(/só permite este tipo/)).toBeInTheDocument();
  });

  it('ECS para EC2: oferece só data e runs-on; trocar para data cria o volume, e desfaz', async () => {
    const user = userEvent.setup();
    open('edg_host');
    const select = screen.getByLabelText('Tipo da conexão');
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.getAttribute('value')),
    ).toEqual(['data', 'runs-on']);
    expect(screen.queryByLabelText('Volume de dados por mês')).toBeNull();
    expect(screen.getByText(/custo do ECS está no EC2/)).toBeInTheDocument();
    await user.selectOptions(select, 'data');
    expect(edge('edg_host').kind).toBe('data');
    expect(screen.getByLabelText('Volume de dados por mês')).toHaveValue('10');
    expect(announcerStore.getState().message).toBe('Tipo da conexão: Dados');
    act(() => void designStore.getState().undo());
    expect(edge('edg_host').kind).toBe('runs-on');
  });

  it('a nota diz se a aresta custa e por quê', () => {
    open('edg_1');
    expect(screen.getByText(/^Custa: saída de dados/)).toBeInTheDocument();
    cleanup();
    open('edg_log');
    expect(screen.getByText(/^Custa: ingestão de logs/)).toBeInTheDocument();
  });
});

describe('Conectar a… no inspetor do bloco', () => {
  const pick = (id: string) => {
    designStore.getState().select({ kind: 'block', id });
    return render(<InspectorPanel />);
  };

  it('lista só os destinos permitidos e cria a aresta com o tipo inferido', async () => {
    const user = userEvent.setup();
    pick('blk_ecs');
    const target = screen.getByLabelText('Destino');
    const options = within(target)
      .getAllByRole('option')
      .map((o) => o.getAttribute('value'));
    expect(options).not.toContain('blk_ecs'); // nunca o próprio bloco
    expect(options).not.toContain('blk_ec2'); // já ligado
    expect(options).toContain('blk_logs');
    await user.selectOptions(target, 'blk_logs');
    expect(screen.queryByLabelText('Tipo da conexão')).toBeNull(); // um só tipo: sem escolha
    await user.click(screen.getByRole('button', { name: 'Conectar' }));
    const created = designStore.getState().document.edges.at(-1)!;
    expect(created).toMatchObject({ source: 'blk_ecs', target: 'blk_logs', kind: 'logs' });
    expect(announcerStore.getState().message).toMatch(/^Conexão criada/);
    expect(screen.getByLabelText('Destino')).toHaveValue('');
  });

  it('com mais de um tipo permitido, deixa escolher; o padrão é o inferido', async () => {
    const user = userEvent.setup();
    designStore.setState({ document: { ...doc, edges: [base.edges[0]!] } });
    pick('blk_ecs');
    await user.selectOptions(screen.getByLabelText('Destino'), 'blk_ec2');
    const kind = screen.getByLabelText('Tipo da conexão');
    expect(kind).toHaveValue('runs-on');
    await user.selectOptions(kind, 'data');
    await user.click(screen.getByRole('button', { name: 'Conectar' }));
    expect(designStore.getState().document.edges.at(-1)).toMatchObject({
      target: 'blk_ec2',
      kind: 'data',
    });
  });

  it('o botão fica desligado sem destino e a seção sai quando não há destino', async () => {
    const { container } = pick('blk_ecs');
    expect(screen.getByRole('button', { name: 'Conectar' })).toBeDisabled();
    await expectNoAxeViolations(container);
    cleanup();
    designStore.setState({ document: { ...base, edges: [] } });
    pick('blk_assets');
    expect(screen.getByLabelText('Destino')).toBeInTheDocument();
    cleanup();
    designStore.setState({ document: { ...doc, blocks: [ecs], edges: [] } });
    pick('blk_ecs');
    expect(screen.queryByLabelText('Destino')).toBeNull();
  });
});
