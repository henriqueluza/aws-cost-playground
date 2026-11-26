import { describe, expect, it } from 'vitest';
import { decimal, sum, toFixed, type Decimal } from '../../../../shared/lib/money';
import { catalogOf } from '../../../../test/catalogFixtures';
import type { BlockPriceInput } from '../blockContract';
import { createRater, type Rater } from '../rating';
import { priceAlb } from './alb';

/** Preços de us-east-1 iguais aos da semente, escritos aqui: sem franquia e sem faixas. */
const catalog = catalogOf({
  alb: [
    { sku: 'alb-hours', tiers: [[null, '0.0225']] },
    { sku: 'alb-lcu-hours', tiers: [[null, '0.008']] },
  ],
});

const usageOf = (newPerSecond: number, activePerMinute: number, gb: number, rules: number) => ({
  newConnectionsPerSecond: newPerSecond,
  activeConnectionsPerMinute: activePerMinute,
  processedGbPerMonth: gb,
  ruleEvaluationsPerSecond: rules,
});
const input = (...usage: Parameters<typeof usageOf>) => ({
  attributes: {},
  usage: usageOf(...usage),
});
/** As duas cobranças do bloco, com a LCU-hora do mês esperada. */
const charges = (lcuHours: string) => [
  { sku: 'alb-hours', quantity: decimal('730'), charge: 'fixed' },
  { sku: 'alb-lcu-hours', quantity: decimal(lcuHours), charge: 'variable' },
];
/** Linhas (`sku cobrança quantidade valor`) e total em USD do bloco. */
function rate(rater: Rater, block: BlockPriceInput) {
  const lines = rater.rate(priceAlb(block).map((c) => ({ ...c, service: 'alb' })));
  // `undefined` é SKU fora do catálogo: falha aqui, em vez de virar total zero.
  if (lines === undefined) throw new Error('cobrança sem preço no catálogo do teste');
  const usd = (value: Decimal) => toFixed(value, 6);
  return {
    lines: lines.map((l) => `${l.sku} ${l.charge} ${usd(l.quantity)} ${usd(l.amount)}`),
    total: usd(sum(lines.map((l) => l.amount))),
  };
}

describe('priceAlb', () => {
  it.each([
    // 50 × 730 / 25 = 1.460; 3.000 × 730 / 3.000 = 730; 100; 500 × 730 / 1.000 = 365 (soma: 2.655).
    ['conexões novas', input(50, 3000, 100, 500), '1460'],
    // 10 × 730 / 25 = 292; 30.000 × 730 / 3.000 = 7.300; 100; 1.000 × 730 / 1.000 = 730.
    ['conexões ativas', input(10, 30000, 100, 1000), '7300'],
    // 292; 600 × 730 / 3.000 = 146; 500; 0.
    ['GB processado', input(10, 600, 500, 0), '500'],
    // 292; 146; 100; 2.000 × 730 / 1.000 = 1.460.
    ['avaliações de regra', input(10, 600, 100, 2000), '1460'],
    // Uso zero ainda emite as duas cobranças.
    ['uso zero', input(0, 0, 0, 0), '0'],
  ])('LCU-hora é a maior dimensão, não a soma: %s', (_, block, lcuHours) => {
    expect(priceAlb(block)).toStrictEqual(charges(lcuHours));
  });

  it('multiplica por 730 antes de dividir: um só arredondamento, na 12ª casa', () => {
    // 1.000 × 730 / 3.000 = 243,333…; dividir antes daria 0,333333333333 × 730 = 243,33333333309.
    expect(priceAlb(input(0, 1000, 0, 0))).toStrictEqual(charges('243.333333333333'));
  });

  it('cenário 2: horas fixas e 365 LCU-hora variáveis', () => {
    // LCU = max(292, 146, 365, 0) = 365. 730 × 0,0225 = 16,425; 365 × 0,008 = 2,92.
    expect(rate(createRater(catalog), input(10, 600, 365, 0))).toStrictEqual({
      lines: ['alb-hours fixed 730.000000 16.425000', 'alb-lcu-hours variable 365.000000 2.920000'],
      total: '19.345000',
    });
  });

  it.each([
    // Sem franquia: o balanceador parado paga as 730 h; 730 × 0,0225 = 16,425.
    [0, '16.425000'],
    // A primeira LCU-hora já é cobrada: 16,425 + 1 × 0,008 = 16,433.
    [1, '16.433000'],
  ])('cobra desde a primeira unidade: %i GB', (gb, total) => {
    expect(rate(createRater(catalog), input(0, 0, gb, 0)).total).toBe(total);
  });

  it('dois balanceadores pagam cada um as próprias horas e LCU', () => {
    // Sem faixas nem franquia, o segundo paga o mesmo que o primeiro: 2 × 19,345 = 38,69.
    const rater = createRater(catalog);
    const totals = [1, 2].map(() => rate(rater, input(10, 600, 365, 0)).total);
    expect(totals).toStrictEqual(['19.345000', '19.345000']);
  });

  const full = usageOf(1, 1, 1, 1);
  const outside: [string, Record<string, number>][] = [
    ...Object.keys(full).map((key): [string, Record<string, number>] => [
      `sem ${key}`,
      Object.fromEntries(Object.entries(full).filter(([k]) => k !== key)),
    ]),
    ['só chaves do protótipo', { toString: 1, valueOf: 1, constructor: 1 }],
  ];
  it.each(outside)('lança RangeError fora do contrato: %s', (_, usage) => {
    const call = () => priceAlb({ attributes: {}, usage });
    expect(call).toThrow(RangeError);
    expect(call).toThrow('aws.alb: uso fora do contrato');
  });
});
