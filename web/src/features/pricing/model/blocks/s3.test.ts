import { describe, expect, it } from 'vitest';
import saEast1Seed from '../../../../../public/prices/sa-east-1/s3.json';
import usEast1Seed from '../../../../../public/prices/us-east-1/s3.json';
import { designDocumentSchema, type Block, type Region } from '../../../../shared/lib/design';
import { decimal, toFixed } from '../../../../shared/lib/money';
import { adrExampleDesign } from '../../../../test/designFixtures';
import type { BlockPriceInput } from '../blockContract';
import { blockDefinition } from '../blockRegistry';
import { priceFileSchema, type PriceCatalog } from '../catalog';
import { estimate, type BlockCost } from '../engine';
import { createRater } from '../rating';
import { priceS3 } from './s3';

/** Catálogo de uma região só com a semente real do S3, validada pelo schema do catálogo. */
function seedCatalog(seed: unknown): PriceCatalog {
  const file = priceFileSchema.parse(seed);
  return {
    region: file.region,
    manifest: { schemaVersion: 1, source: 'seed', generatedAt: '2026-11-25T00:00:00Z', files: [] },
    services: new Map([['s3', file]]),
  };
}
const catalogs = { 'us-east-1': seedCatalog(usEast1Seed), 'sa-east-1': seedCatalog(saEast1Seed) };

/** Custo de um bloco S3 sozinho num design, pelo motor e pelo contrato reais. */
function priceBlock(region: Region, attributes: Block['attributes'], values: object): BlockCost {
  const s3 = { ...adrExampleDesign.blocks[1], attributes, usage: { source: 'default', values } };
  const design = { ...adrExampleDesign, region, blocks: [{ ...s3, overrides: {} }], edges: [] };
  return estimate(designDocumentSchema.parse(design), catalogs[region]).blocks[0]!;
}
const lines = (block: BlockCost) =>
  block.lines.map((l) => [l.sku, toFixed(l.quantity, 6), toFixed(l.amount, 6), l.charge].join(' '));
const rate = (region: Region, input: BlockPriceInput) =>
  createRater(catalogs[region]).rate(priceS3(input).map((c) => ({ ...c, service: 's3' })));
const usage = (storageGb: number, putRequestsPerMonth: number, getRequestsPerMonth: number) => ({
  storageGb,
  putRequestsPerMonth,
  getRequestsPerMonth,
});

describe('priceS3', () => {
  it.each([
    // 5 × 0,023 = 0,115; 2.000 × 0,000005 = 0,01; 500.000 × 0,0000004 = 0,2.
    ['us-east-1', 'STANDARD', usage(5, 2000, 500000), ['0.115', '0.01', '0.2'], '0.325'],
    // 100 × 0,0125 = 1,25; 1.000 × 0,00001 = 0,01; 1.000 × 0,000001 = 0,001.
    ['us-east-1', 'STANDARD_IA', usage(100, 1000, 1000), ['1.25', '0.01', '0.001'], '1.261'],
    // 50 × 0,0405 = 2,025; 10.000 × 0,000007 = 0,07; 100.000 × 0,00000056 = 0,056.
    ['sa-east-1', 'STANDARD', usage(50, 10000, 100000), ['2.025', '0.07', '0.056'], '2.151'],
  ] as const)('confere à mão %s %s', (region, storageClass, values, amounts, total) => {
    const block = priceBlock(region, { storageClass }, values);
    const suffix = storageClass === 'STANDARD' ? 'standard' : 'standard-ia';
    expect(block.lines.map((l) => [l.sku, l.charge])).toEqual(
      ['storage', 'requests-put', 'requests-get'].map((kind) => [
        `s3-${kind}-${suffix}`,
        'variable',
      ]),
    );
    expect(block.lines.map((l) => l.amount)).toEqual(amounts.map((amount) => decimal(amount)));
    expect(block).toMatchObject({ status: 'priced', total: decimal(total), fixed: decimal(0) });
  });

  it('troca de faixa no armazenamento: 60.000 GB Standard em duas linhas', () => {
    // 51.200 × 0,023 = 1.177,6 + 8.800 × 0,022 = 193,6 = 1.371,2.
    const block = priceBlock('us-east-1', { storageClass: 'STANDARD' }, usage(60000, 0, 0));
    expect(lines(block).slice(0, 2)).toEqual([
      's3-storage-standard 51200.000000 1177.600000 variable',
      's3-storage-standard 8800.000000 193.600000 variable',
    ]);
    expect(block.total).toBe(decimal('1371.2'));
  });

  it('sem atributo nem uso, aplica o padrão do contrato: Standard, 50 GB, 100 mil PUT, 1 milhão GET', () => {
    // 50 × 0,023 = 1,15 + 100.000 × 0,000005 = 0,5 + 1.000.000 × 0,0000004 = 0,4 = 2,05.
    const block = priceBlock('us-east-1', {}, {});
    expect(lines(block)).toEqual([
      's3-storage-standard 50.000000 1.150000 variable',
      's3-requests-put-standard 100000.000000 0.500000 variable',
      's3-requests-get-standard 1000000.000000 0.400000 variable',
    ]);
    expect(block.total).toBe(decimal('2.05'));
  });

  it('classe fora do catálogo ou que não é texto não tem preço, nunca zero', () => {
    const glacier = priceBlock('us-east-1', { storageClass: 'GLACIER' }, usage(5, 0, 0));
    expect(glacier).toMatchObject({ status: 'unavailable', lines: [], total: decimal(0) });
    for (const storageClass of ['GLACIER', 1, true]) {
      expect(rate('us-east-1', { attributes: { storageClass }, usage: usage(5, 0, 0) })).toBe(
        undefined,
      );
    }
    expect(rate('us-east-1', { attributes: {}, usage: usage(5, 0, 0) })).toBe(undefined);
  });

  const classes = blockDefinition('aws.s3')!.attributes.find((a) => a.key === 'storageClass')!;
  const regions = ['us-east-1', 'sa-east-1'] as const;
  it.each(regions.flatMap((r) => classes.options.map((c) => [r, c] as const)))(
    'toda classe do contrato tem os 3 SKUs na semente; uso zero cobra zero, uma linha por SKU: %s %s',
    (region, storageClass) => {
      const priced = rate(region, { attributes: { storageClass }, usage: usage(0, 0, 0) });
      expect(priced?.map((l) => l.sku)).toEqual(
        priceS3({ attributes: { storageClass }, usage: usage(0, 0, 0) }).map((c) => c.sku),
      );
      priced?.forEach((line) => expect(line.amount).toBe(decimal(0)));
    },
  );
});
