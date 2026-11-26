import { describe, expect, it } from 'vitest';
import type { BlockCost, CostEstimate, EdgeCost } from '../../pricing';
import { add, decimal, toFixed, type Decimal } from '../../../shared/lib/money';
import {
  compareEstimates,
  contextDifferences,
  directionOf,
  normalizeWorkload,
  type Amounts,
} from './compare';

const money = (value: string): Decimal => decimal(value);

function block(
  type: string,
  fixed: string,
  variable = '0',
  status: BlockCost['status'] = 'priced',
) {
  const [f, v] = [money(fixed), money(variable)];
  return {
    status,
    blockId: `blk_${type}`,
    blockType: type,
    total: add(f, v),
    fixed: f,
    variable: v,
    lines: [],
  } as BlockCost;
}
function edge(kind: EdgeCost['kind'], variable: string): EdgeCost {
  const v = money(variable);
  return {
    status: 'priced',
    edgeId: `edg_${kind}`,
    kind,
    total: v,
    fixed: money('0'),
    variable: v,
    lines: [],
  };
}
function estimateOf(blocks: BlockCost[], edges: EdgeCost[] = []): CostEstimate {
  const items = [...blocks, ...edges];
  const fixed = items.reduce((acc, i) => add(acc, i.fixed), money('0'));
  const variable = items.reduce((acc, i) => add(acc, i.variable), money('0'));
  return { total: add(fixed, variable), fixed, variable, blocks, edges, warnings: [] };
}
const text = (a: Amounts) => [toFixed(a.a, 4), toFixed(a.b, 4), toFixed(a.diff, 4)];

describe('compareEstimates', () => {
  it('soma e subtrai em Decimal: total, fixo e variável de cada lado e a diferença b − a', () => {
    const a = estimateOf([block('aws.ec2', '10.10', '0.20')], [edge('data', '1.1')]);
    const b = estimateOf([block('aws.ec2', '20.20', '0.30')], [edge('data', '0.1')]);
    const result = compareEstimates(a, b);
    expect(text(result.total)).toEqual(['11.4000', '20.6000', '9.2000']);
    expect(text(result.fixed)).toEqual(['10.1000', '20.2000', '10.1000']);
    expect(text(result.variable)).toEqual(['1.3000', '0.4000', '-0.9000']);
  });

  it('une os tipos dos dois lados: tipo só de um lado tem zero e contagem 0 no outro', () => {
    const a = estimateOf([block('aws.ec2', '30'), block('aws.ec2', '30'), block('aws.s3', '5')]);
    const b = estimateOf([block('aws.s3', '5'), block('aws.rds', '40')]);
    const rows = compareEstimates(a, b).blocks;
    expect(rows.map((r) => [r.key, r.countA, r.countB, toFixed(r.total.diff, 2)])).toEqual([
      ['aws.ec2', 2, 0, '-60.00'],
      ['aws.rds', 0, 1, '40.00'],
      ['aws.s3', 1, 1, '0.00'],
    ]);
  });

  it('designs iguais: toda diferença é zero e a direção é "same"', () => {
    const one = estimateOf([block('aws.ec2', '30', '2')], [edge('logs', '3')]);
    const result = compareEstimates(one, one);
    const all = [
      result.total,
      result.fixed,
      result.variable,
      ...result.blocks.map((r) => r.total),
      ...result.edges.map((r) => r.total),
    ];
    expect(all.length).toBe(5);
    for (const row of all) expect(directionOf(row.diff)).toBe('same');
  });

  it('arestas por tipo: só os tipos usados, na ordem do contrato', () => {
    const a = estimateOf([], [edge('logs', '2'), edge('data', '1')]);
    const b = estimateOf([], [edge('logs', '5')]);
    const rows = compareEstimates(a, b).edges;
    expect(rows.map((r) => [r.key, r.countA, r.countB, toFixed(r.total.diff, 2)])).toEqual([
      ['data', 1, 0, '-1.00'],
      ['logs', 1, 1, '3.00'],
    ]);
  });

  it('a diferença é a dos valores como aparecem, em centavos meio-para-par', () => {
    const diffOf = (x: string, y: string) =>
      toFixed(
        compareEstimates(estimateOf([block('aws.sqs', x)]), estimateOf([block('aws.sqs', y)])).total
          .diff,
        2,
      );
    // 131,275 → 131,28 e 29,665 → 29,66 (meio-para-par): a conta da tela fecha, 29,66 − 131,28.
    expect(diffOf('131.275', '29.665')).toBe('-101.62');
    // Menos de meio centavo de diferença some: os dois lados mostram o mesmo valor.
    expect(diffOf('0.004', '0.0049')).toBe('0.00');
    // Exato seria 0,01; mostrado, 10,00 → 10,02.
    expect(diffOf('10.005', '10.015')).toBe('0.02');
    // 0,1 + 0,2 − 0,3 é exatamente zero em Decimal (em number daria 5,5e-17).
    const sums = compareEstimates(
      estimateOf([block('aws.sqs', '0.1'), block('aws.sqs', '0.2')]),
      estimateOf([block('aws.sqs', '0.3')]),
    );
    expect(directionOf(sums.total.diff)).toBe('same');
  });

  it('conta os itens sem preço de cada lado', () => {
    const a = estimateOf([block('aws.ec2', '0', '0', 'unavailable')]);
    const b = estimateOf([block('aws.ec2', '1')]);
    expect(compareEstimates(a, b).unavailable).toEqual({ a: 1, b: 0 });
  });
});

describe('contextDifferences', () => {
  const doc = (region: 'us-east-1' | 'sa-east-1', description: string) => ({
    region,
    workload: { description },
  });

  it('regiões diferentes', () => {
    expect(contextDifferences(doc('us-east-1', 'x'), doc('sa-east-1', 'x'))).toEqual({
      region: true,
      workload: false,
    });
  });
  it('cargas iguais depois de normalizar espaços e quebras de linha', () => {
    expect(
      contextDifferences(
        doc('us-east-1', '  API  com\n3 milhões '),
        doc('us-east-1', 'API com 3 milhões'),
      ),
    ).toEqual({ region: false, workload: false });
  });
  it('cargas diferentes', () => {
    expect(contextDifferences(doc('us-east-1', 'API'), doc('us-east-1', 'Site'))).toEqual({
      region: false,
      workload: true,
    });
  });
  it('normaliza só espaços', () => {
    expect(normalizeWorkload('\t a \n b  ')).toBe('a b');
  });
});
