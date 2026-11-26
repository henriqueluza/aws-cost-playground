import { describe, expect, it } from 'vitest';
import { decimal, sum, toFixed } from '../../../../shared/lib/money';
import { catalogOf } from '../../../../test/catalogFixtures';
import type { BlockPriceInput } from '../blockContract';
import { createRater, type Rater } from '../rating';
import { priceCloudWatch } from './cloudwatch';

/** Preços de us-east-1 iguais aos da semente, escritos aqui: a semente muda com o catálogo real. */
const catalog = catalogOf({
  cloudwatch: [
    { sku: 'cloudwatch-logs-ingestion', tiers: [[null, '0.5']], freeTier: { quantity: '5' } },
    { sku: 'cloudwatch-logs-storage', tiers: [[null, '0.03']], freeTier: { quantity: '5' } },
    {
      sku: 'cloudwatch-custom-metrics',
      tiers: [
        ['10000', '0.3'],
        ['250000', '0.1'],
        ['1000000', '0.05'],
        [null, '0.02'],
      ],
      freeTier: { quantity: '10' },
    },
    { sku: 'cloudwatch-alarms', tiers: [[null, '0.1']], freeTier: { quantity: '10' } },
  ],
});

type Usage = {
  [K in 'logsIngestedGbPerMonth' | 'logsStoredGb' | 'customMetrics' | 'alarms']: number;
};
const NO_USAGE: Usage = { logsIngestedGbPerMonth: 0, logsStoredGb: 0, customMetrics: 0, alarms: 0 };
/** Padrões do contrato: 5 GB ingeridos, 5 GB guardados, 10 métricas e 10 alarmes. */
const DEFAULTS: Usage = {
  logsIngestedGbPerMonth: 5,
  logsStoredGb: 5,
  customMetrics: 10,
  alarms: 10,
};
/** Bloco sem atributos; o que não for informado vale zero. */
const input = (usage: Partial<Usage>): BlockPriceInput => ({
  attributes: {},
  usage: { ...NO_USAGE, ...usage },
});
/** As quatro cobranças, sempre nesta ordem: ingestão, armazenamento, métricas e alarmes. */
const charges = (ingested: string, stored: string, metrics: string, alarms: string) => [
  { sku: 'cloudwatch-logs-ingestion', quantity: decimal(ingested), charge: 'variable' },
  { sku: 'cloudwatch-logs-storage', quantity: decimal(stored), charge: 'variable' },
  { sku: 'cloudwatch-custom-metrics', quantity: decimal(metrics), charge: 'fixed' },
  { sku: 'cloudwatch-alarms', quantity: decimal(alarms), charge: 'fixed' },
];
/**
 * Linhas (`sku cobrança quantidade valor`) e total em USD, na franquia e faixa que restam.
 * `edgeLogsGb` é o que uma aresta `logs` cobra (#42): o mesmo SKU de ingestão, no mesmo rater.
 */
function rate(rater: Rater, block: BlockPriceInput, edgeLogsGb?: string) {
  const edge = { sku: 'cloudwatch-logs-ingestion', charge: 'variable' as const };
  const charges = [
    ...priceCloudWatch(block),
    ...(edgeLogsGb === undefined ? [] : [{ ...edge, quantity: decimal(edgeLogsGb) }]),
  ];
  const lines = rater.rate(charges.map((c) => ({ ...c, service: 'cloudwatch' })));
  // `undefined` é SKU fora do catálogo: falha aqui, em vez de virar total zero.
  if (lines === undefined) throw new Error('cobrança sem preço no catálogo do teste');
  return {
    lines: lines.map(
      (l) => `${l.sku} ${l.charge} ${toFixed(l.quantity, 2)} ${toFixed(l.amount, 2)}`,
    ),
    total: toFixed(sum(lines.map((l) => l.amount)), 2),
  };
}
const zeroLine = (sku: string, kind: 'fixed' | 'variable') => `cloudwatch-${sku} ${kind} 0.00 0.00`;

describe('priceCloudWatch', () => {
  it.each([
    // Uso zero ainda emite as quatro cobranças.
    ['uso zero', NO_USAGE, charges('0', '0', '0', '0')],
    ['padrões do contrato', DEFAULTS, charges('5', '5', '10', '10')],
    // Fração em Decimal, sem erro de ponto flutuante.
    ['fração', { logsIngestedGbPerMonth: 0.1, logsStoredGb: 0.2 }, charges('0.1', '0.2', '0', '0')],
    [
      'cada chave na sua cobrança',
      { logsIngestedGbPerMonth: 1, logsStoredGb: 2.5, customMetrics: 3, alarms: 4 },
      charges('1', '2.5', '3', '4'),
    ],
  ])('cobra ingestão, armazenamento, métricas e alarmes: %s', (_, usage, expected) => {
    expect(priceCloudWatch(input(usage))).toStrictEqual(expected);
  });

  it('nos padrões do contrato tudo cabe na franquia e as quatro linhas aparecem zeradas', () => {
    expect(rate(createRater(catalog), input(DEFAULTS))).toStrictEqual({
      lines: [
        zeroLine('logs-ingestion', 'variable'),
        zeroLine('logs-storage', 'variable'),
        zeroLine('custom-metrics', 'fixed'),
        zeroLine('alarms', 'fixed'),
      ],
      total: '0.00',
    });
  });

  it('desconta as franquias de logs e de alarmes', () => {
    // (7,5 − 5) × 0,50 = 1,25; (105 − 5) × 0,03 = 3,00; (25 − 10) × 0,10 = 1,50. Total 5,75.
    const block = input({ logsIngestedGbPerMonth: 7.5, logsStoredGb: 105, alarms: 25 });
    expect(rate(createRater(catalog), block)).toStrictEqual({
      lines: [
        'cloudwatch-logs-ingestion variable 2.50 1.25',
        'cloudwatch-logs-storage variable 100.00 3.00',
        zeroLine('custom-metrics', 'fixed'),
        'cloudwatch-alarms fixed 15.00 1.50',
      ],
      total: '5.75',
    });
  });

  it.each([
    // Limites das franquias: 5 GB ingeridos, 5 GB guardados e 10 alarmes, cada uma a sua.
    [{ logsIngestedGbPerMonth: 5 }, '0.00'],
    [{ logsIngestedGbPerMonth: 5.5 }, '0.25'],
    [{ logsStoredGb: 5 }, '0.00'],
    [{ logsStoredGb: 6 }, '0.03'],
    [{ logsIngestedGbPerMonth: 5, logsStoredGb: 5 }, '0.00'],
    [{ alarms: 10 }, '0.00'],
    [{ alarms: 11 }, '0.10'],
  ])('franquia no limite: %o', (usage, total) => {
    expect(rate(createRater(catalog), input(usage)).total).toBe(total);
  });

  it.each([
    // 10 métricas grátis; a faixa de 0,30 vai até 10.000 cobradas.
    [10010, ['10000.00 3000.00'], '3000.00'],
    [10011, ['10000.00 3000.00', '1.00 0.10'], '3000.10'],
    // 10.000 × 0,30 + 2.000 × 0,10 = 3.200,00.
    [12010, ['10000.00 3000.00', '2000.00 200.00'], '3200.00'],
  ])('troca de faixa nas métricas customizadas: %i', (customMetrics, metricLines, total) => {
    const priced = rate(createRater(catalog), input({ customMetrics }));
    expect(priced.lines.filter((l) => l.startsWith('cloudwatch-custom-metrics'))).toEqual(
      metricLines.map((l) => `cloudwatch-custom-metrics fixed ${l}`),
    );
    expect(priced.total).toBe(total);
  });

  it('dois blocos dividem a franquia e a posição nas faixas das métricas', () => {
    // A: 600.000 cobradas = 10.000 × 0,30 + 240.000 × 0,10 + 350.000 × 0,05 = 44.500,00.
    // B parte de 600.000: 400.000 × 0,05 + 100.000 × 0,02 = 22.000,00.
    const rater = createRater(catalog);
    const metricLines = (block: BlockPriceInput) =>
      rate(rater, block).lines.filter((l) => l.startsWith('cloudwatch-custom-metrics'));
    expect(metricLines(input({ customMetrics: 600010 }))).toEqual([
      'cloudwatch-custom-metrics fixed 10000.00 3000.00',
      'cloudwatch-custom-metrics fixed 240000.00 24000.00',
      'cloudwatch-custom-metrics fixed 350000.00 17500.00',
    ]);
    expect(metricLines(input({ customMetrics: 500000 }))).toEqual([
      'cloudwatch-custom-metrics fixed 400000.00 20000.00',
      'cloudwatch-custom-metrics fixed 100000.00 2000.00',
    ]);
  });

  it('a aresta logs cobra o mesmo SKU e divide a franquia de ingestão com o bloco', () => {
    // Cenário 1 de docs/scenarios.md: bloco com ingestão zero, 3 GB guardados, 20 métricas e 15
    // alarmes; a aresta traz 20 GB. Bloco: 0 + 0 (3 < 5) + (20 − 10) × 0,30 + (15 − 10) × 0,10 =
    // 3,50. Aresta: (20 − 5) × 0,50 = 7,50. Total 11,00.
    const block = input({ logsStoredGb: 3, customMetrics: 20, alarms: 15 });
    expect(rate(createRater(catalog), block, '20')).toStrictEqual({
      lines: [
        zeroLine('logs-ingestion', 'variable'),
        zeroLine('logs-storage', 'variable'),
        'cloudwatch-custom-metrics fixed 10.00 3.00',
        'cloudwatch-alarms fixed 5.00 0.50',
        'cloudwatch-logs-ingestion variable 15.00 7.50',
      ],
      total: '11.00',
    });
    // O bloco usa 3 dos 5 GB; a aresta de 4,5 GB paga (3 + 4,5 − 5) × 0,50 = 1,25.
    expect(rate(createRater(catalog), input({ logsIngestedGbPerMonth: 3 }), '4.5').total).toBe(
      '1.25',
    );
  });

  it.each(Object.keys(DEFAULTS))('lança RangeError sem a chave de uso %s', (missing) => {
    const usage = Object.fromEntries(Object.entries(DEFAULTS).filter(([key]) => key !== missing));
    const call = () => priceCloudWatch({ attributes: {}, usage });
    expect(call).toThrow(RangeError);
    expect(call).toThrow('aws.cloudwatch: uso fora do contrato');
  });
});
