import { describe, expect, it } from 'vitest';
import { toFixed } from '../../../../shared/lib/money';
import { catalogOf } from '../../../../test/catalogFixtures';
import type { BlockPriceInput } from '../blockContract';
import type { CostLine } from '../engine';
import { createRater } from '../rating';
import { priceS3 } from './s3';

/** Preços de us-east-1 iguais aos da semente, escritos aqui: a semente muda com o catálogo real. */
const catalog = catalogOf({
  s3: [
    {
      sku: 's3-storage-standard',
      tiers: [
        ['51200', '0.023'],
        ['512000', '0.022'],
        [null, '0.021'],
      ],
    },
    { sku: 's3-storage-standard-ia', tiers: [[null, '0.0125']] },
    { sku: 's3-requests-put-standard', tiers: [[null, '0.000005']] },
    { sku: 's3-requests-get-standard', tiers: [[null, '0.0000004']] },
    { sku: 's3-requests-put-standard-ia', tiers: [[null, '0.00001']] },
    { sku: 's3-requests-get-standard-ia', tiers: [[null, '0.000001']] },
  ],
});

const input = (attrs: BlockPriceInput['attributes'], gb: number, put: number, get: number) => ({
  attributes: attrs,
  usage: { storageGb: gb, putRequestsPerMonth: put, getRequestsPerMonth: get },
});
/** Linha `sku quantidade valor cobrança`; cada `rate` usa um `Rater` novo: a faixa é da conta. */
const line = (l: CostLine) =>
  `${l.sku} ${toFixed(l.quantity, 6)} ${toFixed(l.amount, 6)} ${l.charge}`;
const rate = (block: BlockPriceInput) =>
  createRater(catalog).rate(priceS3(block).map((c) => ({ ...c, service: 's3' })));

describe('priceS3', () => {
  it('cobra GB-mês, PUT e GET pelo preço de cada classe', () => {
    // 5 × 0,023 = 0,115; 2.000 × 0,000005 = 0,01; 500.000 × 0,0000004 = 0,2.
    expect(rate(input({ storageClass: 'STANDARD' }, 5, 2000, 500000))?.map(line)).toEqual([
      's3-storage-standard 5.000000 0.115000 variable',
      's3-requests-put-standard 2000.000000 0.010000 variable',
      's3-requests-get-standard 500000.000000 0.200000 variable',
    ]);
    // 100 × 0,0125 = 1,25; 1.000 × 0,00001 = 0,01; 1.000 × 0,000001 = 0,001.
    expect(rate(input({ storageClass: 'STANDARD_IA' }, 100, 1000, 1000))?.map(line)).toEqual([
      's3-storage-standard-ia 100.000000 1.250000 variable',
      's3-requests-put-standard-ia 1000.000000 0.010000 variable',
      's3-requests-get-standard-ia 1000.000000 0.001000 variable',
    ]);
  });

  it('troca de faixa depois de 51.200 GB; uso zero ainda emite uma linha zerada por SKU', () => {
    // 51.200 × 0,023 = 1.177,6 + 8.800 × 0,022 = 193,6: total 1.371,2.
    expect(rate(input({ storageClass: 'STANDARD' }, 60000, 0, 0))?.map(line)).toEqual([
      's3-storage-standard 51200.000000 1177.600000 variable',
      's3-storage-standard 8800.000000 193.600000 variable',
      's3-requests-put-standard 0.000000 0.000000 variable',
      's3-requests-get-standard 0.000000 0.000000 variable',
    ]);
    expect(rate(input({ storageClass: 'STANDARD' }, 0, 0, 0))?.map(line)).toEqual([
      's3-storage-standard 0.000000 0.000000 variable',
      's3-requests-put-standard 0.000000 0.000000 variable',
      's3-requests-get-standard 0.000000 0.000000 variable',
    ]);
  });

  it.each([[{ storageClass: 'GLACIER' }], [{ storageClass: 1 }], [{}]])('%j sem preço', (attrs) => {
    // Classe sem SKU, que não é texto ou ausente: o motor marca o bloco `unavailable`, nunca zero.
    expect(rate(input(attrs, 5, 2000, 500000))).toBeUndefined();
  });
});
