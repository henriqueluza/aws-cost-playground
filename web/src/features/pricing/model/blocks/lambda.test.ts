import { describe, expect, it } from 'vitest';
import { decimal, sum, toFixed } from '../../../../shared/lib/money';
import { catalogOf, type RawPrice } from '../../../../test/catalogFixtures';
import type { BlockPriceInput } from '../blockContract';
import { createRater, type Rater } from '../rating';
import { priceLambda } from './lambda';

/** Preços de us-east-1 iguais aos da semente, escritos aqui: a semente muda com o catálogo real. */
const requests = (sku: string): RawPrice => ({
  sku,
  tiers: [[null, '0.0000002']],
  freeTier: { quantity: '1000000', pool: 'lambda-requests' },
});
const durationFree = { quantity: '400000', pool: 'lambda-duration' };
const catalog = catalogOf({
  lambda: [
    requests('lambda-requests-x86'),
    requests('lambda-requests-arm64'),
    {
      sku: 'lambda-duration-x86',
      tiers: [
        ['6000000000', '0.0000166667'],
        ['15000000000', '0.000015'],
        [null, '0.0000133334'],
      ],
      freeTier: durationFree,
    },
    {
      sku: 'lambda-duration-arm64',
      tiers: [
        ['7500000000', '0.0000133334'],
        ['18750000000', '0.0000120001'],
        [null, '0.0000106667'],
      ],
      freeTier: durationFree,
    },
  ],
});

const input = (architecture: string, memoryMb: number, req: number, ms: number) => ({
  attributes: { architecture, memoryMb },
  usage: { requestsPerMonth: req, avgDurationMs: ms },
});
/** Linhas (`sku quantidade valor`) e total em USD do bloco, na franquia e faixa que restam. */
function rate(rater: Rater, block: BlockPriceInput) {
  const lines = rater.rate(priceLambda(block).map((c) => ({ ...c, service: 'lambda' }))) ?? [];
  return {
    lines: lines.map((l) => `${l.sku} ${toFixed(l.quantity, 6)} ${toFixed(l.amount, 6)}`),
    total: toFixed(sum(lines.map((l) => l.amount)), 6),
  };
}

describe('priceLambda', () => {
  it.each([
    // GB-s = requisições × ms / 1.000 × MB / 1.024: 1 × 0,001 × 0,125 = 0,000125.
    ['x86_64', 128, 1, 1, 'x86', '1', '0.000125'],
    // 3.000.000 × 0,08 × 0,5 = 120.000 GB-s.
    ['arm64', 512, 3e6, 80, 'arm64', '3000000', '120000'],
    // Uso zero ainda emite as duas cobranças.
    ['arm64', 10240, 0, 900000, 'arm64', '0', '0'],
  ])('cobra requisições e GB-s da arquitetura: %s, %i MB', (arch, mb, req, ms, sku, count, gbs) => {
    expect(priceLambda(input(arch, mb, req, ms))).toStrictEqual([
      { sku: `lambda-requests-${sku}`, quantity: decimal(count), charge: 'variable' },
      { sku: `lambda-duration-${sku}`, quantity: decimal(gbs), charge: 'variable' },
    ]);
  });

  it.each([
    // 500.000 requisições e 500.000 × 0,08 × 0,5 = 20.000 GB-s: tudo na franquia.
    [500000, '0.000000'],
    // Exemplo do cost-estimate.md: (3.000.000 − 1.000.000) × 0,0000002 = 0,40; 120.000 GB-s grátis.
    [3e6, '0.400000'],
  ])('desconta a franquia mensal: %i requisições de 80 ms em 512 MB', (req, total) => {
    expect(rate(createRater(catalog), input('arm64', 512, req, 80)).total).toBe(total);
  });

  it('x86 e arm64 dividem a franquia de requisições e a de GB-s', () => {
    // Cada bloco: 800.000 × 0,3 s × 1 GB = 240.000 GB-s. O x86 usa 800.000 de 1.000.000 e
    // 240.000 de 400.000; o arm64 paga (800.000 − 200.000) × 0,0000002 = 0,12 e
    // (240.000 − 160.000) × 0,0000133334 = 1,066672.
    const rater = createRater(catalog);
    expect(rate(rater, input('x86_64', 1024, 800000, 300)).total).toBe('0.000000');
    expect(rate(rater, input('arm64', 1024, 800000, 300)).lines).toEqual([
      'lambda-requests-arm64 600000.000000 0.120000',
      'lambda-duration-arm64 80000.000000 1.066672',
    ]);
  });

  it('passa à segunda faixa de duração do x86 depois de 6 bilhões de GB-s', () => {
    // 1e8 × 100 s × 1 GB = 1e10 GB-s − 400.000 grátis: 6e9 × 0,0000166667 = 100.000,20 e
    // 3.999.600.000 × 0,000015 = 59.994,00. Requisições: (1e8 − 1e6) × 0,0000002 = 19,80.
    const { lines, total } = rate(createRater(catalog), input('x86_64', 1024, 1e8, 100000));
    expect(lines).toEqual([
      'lambda-requests-x86 99000000.000000 19.800000',
      'lambda-duration-x86 6000000000.000000 100000.200000',
      'lambda-duration-x86 3999600000.000000 59994.000000',
    ]);
    expect(total).toBe('160014.000000');
  });

  const ok = { requestsPerMonth: 1, avgDurationMs: 1 };
  it.each([
    ['arquitetura', { architecture: 'x86', memoryMb: 512 }, ok, 'arquitetura'],
    ['arquitetura do protótipo', { architecture: 'toString', memoryMb: 512 }, ok, 'arquitetura'],
    ['arquitetura ausente', { memoryMb: 512 }, ok, 'arquitetura'],
    ['memória não numérica', { architecture: 'arm64', memoryMb: '512' }, ok, 'memória'],
    ['uso ausente', { architecture: 'arm64', memoryMb: 512 }, { avgDurationMs: 1 }, 'uso'],
  ])('lança RangeError fora do contrato: %s', (_, attributes, usage, field) => {
    const call = () => priceLambda({ attributes, usage });
    expect(call).toThrow(RangeError);
    expect(call).toThrow(`aws.lambda: ${field} fora do contrato`);
  });
});
