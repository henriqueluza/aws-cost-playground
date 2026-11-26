import { describe, expect, it } from 'vitest';
import saEast1 from '../../../../../public/prices/sa-east-1/cloudfront.json';
import usEast1 from '../../../../../public/prices/us-east-1/cloudfront.json';
import { designDocumentSchema, type Region } from '../../../../shared/lib/design';
import { decimal, toFixed } from '../../../../shared/lib/money';
import { adrExampleDesign } from '../../../../test/designFixtures';
import { priceFileSchema, type PriceCatalog } from '../catalog';
import { estimate, type CostLine } from '../engine';
import { createRater } from '../rating';
import { priceCloudFront } from './cloudfront';

/** Catálogo só com a semente real do CloudFront da região. */
const catalogFor = (region: Region, json: unknown): PriceCatalog => ({
  region,
  manifest: { schemaVersion: 1, source: 'seed', generatedAt: '2026-11-25T00:00:00Z', files: [] },
  services: new Map([['cloudfront', priceFileSchema.parse(json)]]),
});
const us = catalogFor('us-east-1', usEast1);
const sa = catalogFor('sa-east-1', saEast1);

const requests = (requestsPerMonth: number) =>
  priceCloudFront({ attributes: {}, usage: { requestsPerMonth } }).map((charge) => ({
    ...charge,
    service: 'cloudfront',
  }));
const transfer = (gb: number) => [
  {
    service: 'cloudfront',
    sku: 'cloudfront-data-transfer-out',
    quantity: decimal(gb),
    charge: 'variable' as const,
  },
];
const amounts = (lines: readonly CostLine[] | undefined) =>
  lines?.map((line) => toFixed(line.amount, 2));

describe('priceCloudFront', () => {
  it('cobra só as requisições HTTPS; a transferência sai da aresta `data` (#42)', () => {
    expect(priceCloudFront({ attributes: {}, usage: { requestsPerMonth: 12e6 } })).toEqual([
      { sku: 'cloudfront-https-requests', quantity: decimal(12e6), charge: 'variable' },
    ]);
  });

  it.each([
    // (12M − 10M de franquia) × 0,000001 = 2,00; (20M − 10M) × 0,000001 = 10,00.
    ['us-east-1', us, 12e6, '2.00'],
    ['us-east-1', us, 20e6, '10.00'],
    ['us-east-1', us, 1e6, '0.00'],
    // sa-east-1: 2M × 0,0000022 = 4,40.
    ['sa-east-1', sa, 12e6, '4.40'],
  ])('confere à mão as requisições na semente de %s: %d', (_, catalog, quantity, expected) => {
    expect(amounts(createRater(catalog).rate(requests(quantity)))).toEqual([expected]);
  });

  it('divide a franquia de 10 milhões entre dois blocos da conta', () => {
    const rater = createRater(us);
    expect(amounts(rater.rate(requests(6e6)))).toEqual(['0.00']);
    expect(amounts(rater.rate(requests(6e6)))).toEqual(['2.00']);
  });

  it('usa o padrão do contrato (1 milhão de requisições), dentro da franquia', () => {
    const block = {
      ...{ id: 'blk_cdn', type: 'aws.cloudfront', label: 'CDN', attributes: {}, overrides: {} },
      usage: { source: 'default', values: {} },
    };
    const design = designDocumentSchema.parse({ ...adrExampleDesign, blocks: [block], edges: [] });
    const [cost] = estimate(design, us).blocks;
    expect(cost?.lines.map((line) => [line.sku, toFixed(line.quantity, 0)])).toEqual([
      ['cloudfront-https-requests', '0'],
    ]);
    expect(toFixed(cost!.total, 2)).toBe('0.00');
  });

  it.each([
    // 1 TB de franquia: 300 GB não pagam; 11264 − 1024 = 10240 GB × 0,085 = 870,40.
    [300, ['0.00']],
    [11264, ['870.40']],
    // 12288 − 1024 = 11264: 10240 × 0,085 = 870,40 + 1024 × 0,08 = 81,92 (total 952,32).
    [12288, ['870.40', '81.92']],
  ])('aplica franquia e faixas da transferência na semente: %d GB', (gb, expected) => {
    expect(amounts(createRater(us).rate(transfer(gb)))).toEqual(expected);
  });
});
