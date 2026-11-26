import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../../test/axe';
import { add, decimal, type Decimal } from '../../../shared/lib/money';
import type { BlockCost, CostEstimate, EdgeCost } from '../../pricing';
import { compareEstimates } from '../model/compare';
import { CompareTable, SummaryStrip } from './CompareTable';

const money = (value: string): Decimal => decimal(value);
const block = (type: string, fixed: string, variable = '0'): BlockCost => ({
  status: 'priced',
  blockId: `blk_${type}`,
  blockType: type,
  total: add(money(fixed), money(variable)),
  fixed: money(fixed),
  variable: money(variable),
  lines: [],
});
const edge = (variable: string): EdgeCost => ({
  status: 'priced',
  edgeId: 'edg_1',
  kind: 'data',
  total: money(variable),
  fixed: money('0'),
  variable: money(variable),
  lines: [],
});
const estimateOf = (blocks: BlockCost[], edges: EdgeCost[] = []): CostEstimate => {
  const fixed = blocks.reduce((sum, b) => add(sum, b.fixed), money('0'));
  const variable = [...blocks, ...edges].reduce((sum, i) => add(sum, i.variable), money('0'));
  return { total: add(fixed, variable), fixed, variable, blocks, edges, warnings: [] };
};

const a = estimateOf([block('aws.ec2', '60.5'), block('aws.s3', '5', '1')], [edge('4')]);
const b = estimateOf([block('aws.s3', '5', '1'), block('aws.rds', '40')]);
const comparison = compareEstimates(a, b);

describe('CompareTable e SummaryStrip', () => {
  it('faixa: total, fixo e variável com A, B e a diferença em sinal, palavra e ícone', () => {
    render(<SummaryStrip comparison={comparison} />);
    const total = screen.getByRole('group', { name: 'Total por mês' });
    expect(total).toHaveTextContent('−US$ 24,50a menos');
    expect(total).toHaveTextContent('A US$ 70,50');
    expect(total).toHaveTextContent('B US$ 46,00');
    expect(screen.getByRole('group', { name: 'Variável' })).toHaveTextContent('−US$ 4,00a menos');
    expect(total.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('tabela semântica: caption, scope, grupos, tipos unidos, "—" com texto para o lado que não tem', async () => {
    const { container } = render(<CompareTable comparison={comparison} />);
    const table = screen.getByRole('table', { name: /Custo mensal por tipo de bloco/ });
    const cols = within(table)
      .getAllByRole('columnheader')
      .filter((h) => h.getAttribute('scope') === 'col');
    expect(cols.map((h) => h.textContent)).toEqual([
      'Tipo',
      'Design A',
      'Design B',
      'Diferença (B − A)',
    ]);
    expect(within(table).getByText('Blocos')).toHaveAttribute('scope', 'rowgroup');
    expect(within(table).getByText('Arestas')).toHaveAttribute('scope', 'rowgroup');
    const rows = within(table).getAllByRole('row');
    const ec2 = rows.find((row) => within(row).queryByText(/EC2/))!;
    expect(within(ec2).getByText('Este design não tem blocos deste tipo.')).toBeInTheDocument();
    expect(ec2).toHaveTextContent('−US$ 60,50a menos');
    const rds = rows.find((row) => within(row).queryByText(/RDS/))!;
    expect(rds).toHaveTextContent('+US$ 40,00a mais');
    const s3 = rows.find((row) => within(row).queryByText(/S3/))!;
    expect(s3).toHaveTextContent('US$ 0,00igual');
    expect(rows.find((row) => within(row).queryByText('Transferência de dados'))).toHaveTextContent(
      '−US$ 4,00a menos',
    );
    expect(screen.getByRole('region', { name: /Tabela de comparação/ })).toHaveAttribute(
      'tabindex',
      '0',
    );
    await expectNoAxeViolations(container);
  });

  it('tipo desconhecido e rótulo com HTML saem só como texto', () => {
    const odd = compareEstimates(
      estimateOf([block('<img src=x onerror=alert(1)>', '1')]),
      estimateOf([]),
    );
    const { container } = render(<CompareTable comparison={odd} />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
  });

  it('a faixa separa fixo e variável por hachura, na mesma escala dos dois lados, e sem texto extra', () => {
    const cmp = compareEstimates(
      estimateOf([block('aws.ec2', '60', '40')]),
      estimateOf([block('aws.ec2', '10', '10')]),
    );
    const { container } = render(<SummaryStrip comparison={cmp} />);
    const svgs = container.querySelectorAll('div[aria-hidden="true"] svg');
    expect(svgs).toHaveLength(2);
    // A: 100 (largura toda), 60% sólido; B: 20 de 100 (20%), metade sólida.
    const [a, b] = Array.from(svgs).map((svg) => svg.querySelectorAll('rect'));
    expect(a![0]).toHaveAttribute('width', '100%');
    expect(a![1]).toHaveAttribute('width', '60%');
    expect(b![0]).toHaveAttribute('width', '20%');
    expect(b![1]).toHaveAttribute('width', '10%');
    expect(svgs[0]!.querySelector('pattern')).not.toBeNull();
    expect(screen.getByRole('group', { name: 'Fixo' }).querySelector('svg')).not.toBeNull();
    expect(screen.getByRole('group', { name: 'Variável' }).querySelector('pattern')).not.toBeNull();
  });

  it('tipo que só um lado tem e custa zero diz "só no A" ou "só no B", não "igual"', () => {
    const cmp = compareEstimates(
      estimateOf([block('aws.iam', '0')]),
      estimateOf([block('aws.sqs', '0')]),
    );
    render(<CompareTable comparison={cmp} />);
    expect(screen.getByRole('row', { name: /IAM/ })).toHaveTextContent('US$ 0,00só no A');
    expect(screen.getByRole('row', { name: /SQS/ })).toHaveTextContent('US$ 0,00só no B');
  });
});
