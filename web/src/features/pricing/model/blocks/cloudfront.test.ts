import { describe, expect, it } from 'vitest';
import { decimal, toFixed } from '../../../../shared/lib/money';
import { catalogOf } from '../../../../test/catalogFixtures';
import { createRater, type Rater, type ServiceCharge } from '../rating';
import { priceCloudFront } from './cloudfront';

/** Preços de us-east-1 iguais aos da semente, escritos aqui: a semente muda com o catálogo real. */
const catalog = catalogOf({
  cloudfront: [
    {
      sku: 'cloudfront-https-requests',
      tiers: [[null, '0.000001']],
      freeTier: { quantity: '10000000' },
    },
    {
      sku: 'cloudfront-data-transfer-out',
      // prettier-ignore
      tiers: [
        ['10240', '0.085'], ['51200', '0.08'], ['153600', '0.06'], ['512000', '0.04'],
        ['1048576', '0.03'], ['5242880', '0.025'], [null, '0.02'],
      ],
      freeTier: { quantity: '1024' },
    },
  ],
});

const service = 'cloudfront';
const requests = (requestsPerMonth: number) =>
  priceCloudFront({ attributes: {}, usage: { requestsPerMonth } }).map((c) => ({ ...c, service }));
/** Valor em USD de cada linha, na franquia e faixa que restam. */
const rate = (rater: Rater, charges: readonly ServiceCharge[]) =>
  (rater.rate(charges) ?? []).map((line) => toFixed(line.amount, 2));

describe('priceCloudFront', () => {
  it('cobra só as requisições HTTPS; a transferência sai da aresta `data` (#42)', () => {
    expect(priceCloudFront({ attributes: {}, usage: { requestsPerMonth: 12e6 } })).toStrictEqual([
      { sku: 'cloudfront-https-requests', quantity: decimal(12e6), charge: 'variable' },
    ]);
  });

  it.each([
    // (12M − 10M) × 0,000001 = 2,00; (20M − 10M) × 0,000001 = 10,00; 1M: uma linha zerada.
    [12e6, '2.00'],
    [20e6, '10.00'],
    [1e6, '0.00'],
  ])('desconta a franquia de 10 milhões de requisições: %d', (req, amount) => {
    expect(rate(createRater(catalog), requests(req))).toEqual([amount]);
  });

  it('divide a franquia entre dois blocos da conta: o segundo paga (12M − 10M) × 0,000001', () => {
    const rater = createRater(catalog);
    expect([6e6, 6e6].flatMap((req) => rate(rater, requests(req)))).toEqual(['0.00', '2.00']);
  });

  it.each([
    // Franquia de 1024 GB; 10240 GB × 0,085 = 870,40; 12288 GB: + 1024 × 0,08 = 81,92 (952,32).
    [300, ['0.00']],
    [11264, ['870.40']],
    [12288, ['870.40', '81.92']],
  ])('cobra a saída para a internet que a aresta da #42 emite: %d GB', (gb, lines) => {
    const out = { service, sku: 'cloudfront-data-transfer-out', quantity: decimal(gb) };
    expect(rate(createRater(catalog), [{ ...out, charge: 'variable' }])).toEqual(lines);
  });

  it('lança RangeError fora do contrato: uso ausente', () => {
    const call = () => priceCloudFront({ attributes: {}, usage: {} });
    expect(call).toThrow(RangeError);
    expect(call).toThrow('aws.cloudfront: uso fora do contrato');
  });
});
