import { describe, expect, it } from 'vitest';
import { decimal, sum, toFixed } from '../../../../shared/lib/money';
import { catalogOf, type RawPrice } from '../../../../test/catalogFixtures';
import type { BlockPriceInput } from '../blockContract';
import { createRater, type Rater } from '../rating';
import { priceEc2 } from './ec2';

/** Preços de us-east-1 (USD por hora) iguais aos da semente: a semente muda com o catálogo real. */
const HOURLY: Record<string, string> = {
  't3.micro': '0.0104',
  't3.small': '0.0208',
  't3.medium': '0.0416',
  't3.large': '0.0832',
  't4g.micro': '0.0084',
  't4g.small': '0.0168',
  't4g.medium': '0.0336',
  'm5.large': '0.096',
  'm5.xlarge': '0.192',
  'c5.large': '0.085',
  'r5.large': '0.126',
};
/** Faixa única, sem franquia: a de 12 meses de conta nova não entra (docs/scenarios.md). */
const catalog = catalogOf({
  ec2: [
    ...Object.entries(HOURLY).map(([type, usd]): RawPrice => ({
      sku: `ec2-instance-${type}`,
      tiers: [[null, usd]],
    })),
    { sku: 'ec2-ebs-gp3', tiers: [[null, '0.08']] },
  ],
});

const input = (instanceType: string, count: number, hours: number, gb: number, az?: string) => ({
  attributes: { instanceType, ...(az === undefined ? {} : { az }) },
  usage: { instanceCount: count, hoursPerMonth: hours, rootVolumeGb: gb },
});
const charges = (instanceType: string, hours: string, gb: string) => [
  { sku: `ec2-instance-${instanceType}`, quantity: decimal(hours), charge: 'fixed' },
  { sku: 'ec2-ebs-gp3', quantity: decimal(gb), charge: 'fixed' },
];
/** Linhas (`sku quantidade valor`) e total em USD do bloco. */
function rate(rater: Rater, block: BlockPriceInput) {
  const lines = rater.rate(priceEc2(block).map((c) => ({ ...c, service: 'ec2' })));
  // `undefined` é SKU fora do catálogo: falha aqui, em vez de virar total zero.
  if (lines === undefined) throw new Error('cobrança sem preço no catálogo do teste');
  return {
    lines: lines.map((l) => `${l.sku} ${toFixed(l.quantity, 6)} ${toFixed(l.amount, 6)}`),
    total: toFixed(sum(lines.map((l) => l.amount)), 6),
  };
}

describe('priceEc2', () => {
  // 2 instâncias × 730 h = 1.460 h; 2 × 30 GB = 60 GB.
  it.each(Object.keys(HOURLY))('cobra as horas de %s e o volume gp3 das instâncias', (type) => {
    expect(priceEc2(input(type, 2, 730, 30))).toStrictEqual(charges(type, '1460', '60'));
  });

  it.each(['a', 'b', 'c', undefined])('a zona %s não muda as cobranças', (az) => {
    expect(priceEc2(input('t3.medium', 1, 730, 30, az))).toStrictEqual(
      charges('t3.medium', '730', '30'),
    );
  });

  it('app-classico: dois blocos t3.medium pagam o mesmo, sem faixa nem franquia', () => {
    // Cada bloco: 730 h × 0,0416 = 30,368 e 30 GB × 0,08 = 2,40. Os dois: 2 × 32,768 = 65,536.
    const rater = createRater(catalog);
    const blocks = ['a', 'b'].map((az) => rate(rater, input('t3.medium', 1, 730, 30, az)));
    const lines = ['ec2-instance-t3.medium 730.000000 30.368000', 'ec2-ebs-gp3 30.000000 2.400000'];
    expect(blocks).toEqual([
      { lines, total: '32.768000' },
      { lines, total: '32.768000' },
    ]);
    expect(toFixed(sum(blocks.map((b) => decimal(b.total))), 6)).toBe('65.536000');
  });

  it.each([
    // 0 h: as 2 instâncias paradas não cobram hora, mas o volume segue: 60 GB × 0,08 = 4,80.
    [
      'instância parada paga o volume',
      input('t3.small', 2, 0, 30),
      ['ec2-instance-t3.small 0.000000 0.000000', 'ec2-ebs-gp3 60.000000 4.800000'],
      '4.800000',
    ],
    // 3 × 100,5 h = 301,5 h × 0,0168 = 5,0652; 3 × 8 GB = 24 GB × 0,08 = 1,92.
    [
      'horas fracionadas',
      input('t4g.small', 3, 100.5, 8),
      ['ec2-instance-t4g.small 301.500000 5.065200', 'ec2-ebs-gp3 24.000000 1.920000'],
      '6.985200',
    ],
    // A primeira hora já custa 0,0104 e 8 GB × 0,08 = 0,64: as 750 h de 12 meses não entram.
    [
      'sem franquia',
      input('t3.micro', 1, 1, 8),
      ['ec2-instance-t3.micro 1.000000 0.010400', 'ec2-ebs-gp3 8.000000 0.640000'],
      '0.650400',
    ],
    // Linear, sem troca de faixa: 1.000 × 744 h = 744.000 h × 0,192 = 142.848,00;
    // 1.000 × 16.384 GB = 16.384.000 GB × 0,08 = 1.310.720,00.
    [
      'máximo do contrato',
      input('m5.xlarge', 1000, 744, 16384),
      [
        'ec2-instance-m5.xlarge 744000.000000 142848.000000',
        'ec2-ebs-gp3 16384000.000000 1310720.000000',
      ],
      '1453568.000000',
    ],
  ])('%s', (_, block, lines, total) => {
    expect(rate(createRater(catalog), block)).toEqual({ lines, total });
  });

  const ok = { instanceCount: 1, hoursPerMonth: 730, rootVolumeGb: 30 };
  const t3 = { instanceType: 't3.small' };
  it.each([
    ['tipo fora do conjunto', { instanceType: 'm6i.large' }, ok, 'tipo de instância'],
    ['tipo do protótipo', { instanceType: 'toString' }, ok, 'tipo de instância'],
    ['tipo ausente', { az: 'a' }, ok, 'tipo de instância'],
    ['sem instanceCount', t3, { hoursPerMonth: 730, rootVolumeGb: 30 }, 'uso'],
    ['sem hoursPerMonth', t3, { instanceCount: 1, rootVolumeGb: 30 }, 'uso'],
    ['sem rootVolumeGb', t3, { instanceCount: 1, hoursPerMonth: 730 }, 'uso'],
  ])('lança RangeError fora do contrato: %s', (_, attributes, usage, field) => {
    const call = () => priceEc2({ attributes, usage });
    expect(call).toThrow(RangeError);
    expect(call).toThrow(`aws.ec2: ${field} fora do contrato`);
  });
});
