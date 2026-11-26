import { describe, expect, it } from 'vitest';
import { decimal, sum, toFixed } from '../../../../shared/lib/money';
import { catalogOf } from '../../../../test/catalogFixtures';
import type { BlockPriceInput } from '../blockContract';
import { createRater, type Rater } from '../rating';
import { priceRoute53 } from './route53';

/** Faixas globais iguais às da semente, escritas aqui: a semente muda com o catálogo real. */
const catalog = catalogOf({
  route53: [
    {
      sku: 'route53-hosted-zones',
      tiers: [
        ['25', '0.5'],
        [null, '0.1'],
      ],
    },
    {
      sku: 'route53-queries',
      tiers: [
        ['1000000000', '0.0000004'],
        [null, '0.0000002'],
      ],
    },
  ],
});

const input = (hostedZones: number, queriesPerMonth: number) => ({
  attributes: {},
  usage: { hostedZones, queriesPerMonth },
});
/** Linhas (`sku quantidade valor`) e total em USD do bloco, na faixa em que a conta está. */
function rate(rater: Rater, block: BlockPriceInput, digits = 2) {
  const lines = rater.rate(priceRoute53(block).map((c) => ({ ...c, service: 'route53' })));
  // `undefined` é SKU fora do catálogo: falha aqui, em vez de virar total zero.
  if (lines === undefined) throw new Error('cobrança sem preço no catálogo do teste');
  return {
    lines: lines.map((l) => `${l.sku} ${toFixed(l.quantity, 0)} ${toFixed(l.amount, digits)}`),
    total: toFixed(sum(lines.map((l) => l.amount)), digits),
  };
}

describe('priceRoute53', () => {
  it.each([
    [1, 1e6],
    [500, 1e11],
    // Consultas zero ainda emitem a cobrança.
    [1, 0],
  ])('cobra zonas (fixo) e consultas (variável): %i zonas, %i consultas', (zones, queries) => {
    expect(priceRoute53(input(zones, queries))).toStrictEqual([
      { sku: 'route53-hosted-zones', quantity: decimal(zones), charge: 'fixed' },
      { sku: 'route53-queries', quantity: decimal(queries), charge: 'variable' },
    ]);
  });

  it('padrão do contrato: 1 zona e 1.000.000 de consultas custam 0,90', () => {
    // 1 × 0,5 = 0,50; 1.000.000 × 0,0000004 = 0,40.
    expect(rate(createRater(catalog), input(1, 1e6))).toStrictEqual({
      lines: ['route53-hosted-zones 1 0.50', 'route53-queries 1000000 0.40'],
      total: '0.90',
    });
  });

  it('sem franquia: a primeira zona e a primeira consulta já são cobradas', () => {
    expect(rate(createRater(catalog), input(1, 1), 7)).toStrictEqual({
      lines: ['route53-hosted-zones 1 0.5000000', 'route53-queries 1 0.0000004'],
      total: '0.5000004',
    });
  });

  it.each([
    // Limite da 1ª faixa: 25 × 0,5 = 12,50, sem linha na 2ª.
    [25, ['route53-hosted-zones 25 12.50'], '12.50'],
    // A 26ª zona passa à 2ª faixa: 12,50 + 1 × 0,1 = 12,60.
    [26, ['route53-hosted-zones 25 12.50', 'route53-hosted-zones 1 0.10'], '12.60'],
    // Máximo do contrato: 12,50 + 475 × 0,1 = 60,00.
    [500, ['route53-hosted-zones 25 12.50', 'route53-hosted-zones 475 47.50'], '60.00'],
  ])('zonas hospedadas por faixa: %i zonas', (zones, zoneLines, total) => {
    expect(rate(createRater(catalog), input(zones, 0))).toStrictEqual({
      lines: [...zoneLines, 'route53-queries 0 0.00'],
      total,
    });
  });

  it('dois blocos de 20 zonas somam volume e passam à segunda faixa', () => {
    // 1º: 20 × 0,5 = 10,00. 2º: 5 × 0,5 = 2,50 até 25 e 15 × 0,1 = 1,50. Total: 14,00.
    const rater = createRater(catalog);
    const [first, second] = [1, 2].map(() => rate(rater, input(20, 0)));
    expect(first).toStrictEqual({
      lines: ['route53-hosted-zones 20 10.00', 'route53-queries 0 0.00'],
      total: '10.00',
    });
    expect(second).toStrictEqual({
      lines: [
        'route53-hosted-zones 5 2.50',
        'route53-hosted-zones 15 1.50',
        'route53-queries 0 0.00',
      ],
      total: '4.00',
    });
  });

  it.each([
    // Limite da 1ª faixa: 1e9 × 0,0000004 = 400,00, sem linha na 2ª.
    [1e9, ['route53-queries 1000000000 400.00'], '400.50'],
    // 400,00 + 500.000.000 × 0,0000002 = 100,00.
    [1.5e9, ['route53-queries 1000000000 400.00', 'route53-queries 500000000 100.00'], '500.50'],
    // Máximo do contrato: 400,00 + 99.000.000.000 × 0,0000002 = 19.800,00.
    [
      1e11,
      ['route53-queries 1000000000 400.00', 'route53-queries 99000000000 19800.00'],
      '20200.50',
    ],
  ])('consultas por faixa: %i consultas (mais 1 zona a 0,50)', (queries, queryLines, total) => {
    expect(rate(createRater(catalog), input(1, queries))).toStrictEqual({
      lines: ['route53-hosted-zones 1 0.50', ...queryLines],
      total,
    });
  });

  it('dois blocos de 1e9 consultas somam volume: o segundo paga a segunda faixa', () => {
    // 1º: 1e9 × 0,0000004 = 400,00. 2º: 1e9 × 0,0000002 = 200,00. Zonas: 2 × 0,50.
    const rater = createRater(catalog);
    const [first, second] = [1, 2].map(() => rate(rater, input(1, 1e9)));
    expect([...first!.lines, ...second!.lines]).toEqual([
      'route53-hosted-zones 1 0.50',
      'route53-queries 1000000000 400.00',
      'route53-hosted-zones 1 0.50',
      'route53-queries 1000000000 200.00',
    ]);
    expect(toFixed(sum([first!.total, second!.total].map(decimal)), 2)).toBe('601.00');
  });

  it.each([
    ['sem zonas', ['hostedZones']],
    ['sem consultas', ['queriesPerMonth']],
    ['sem uso', ['hostedZones', 'queriesPerMonth']],
  ])('lança RangeError fora do contrato: %s', (_, missing) => {
    const usage = Object.fromEntries(
      Object.entries(input(1, 1e6).usage).filter(([key]) => !missing.includes(key)),
    );
    const call = () => priceRoute53({ attributes: {}, usage });
    expect(call).toThrow(RangeError);
    expect(call).toThrow('aws.route53: uso fora do contrato');
  });
});
