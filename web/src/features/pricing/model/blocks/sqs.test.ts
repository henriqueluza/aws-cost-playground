import { describe, expect, it } from 'vitest';
import { decimal, sum, toFixed } from '../../../../shared/lib/money';
import { catalogOf } from '../../../../test/catalogFixtures';
import type { BlockPriceInput } from '../blockContract';
import { createRater, type Rater } from '../rating';
import { priceSqs } from './sqs';

/** Preços de us-east-1 iguais aos da semente, escritos aqui: a semente muda com o catálogo real. */
const freeTier = { quantity: '1000000', pool: 'sqs-requests' };
const catalog = catalogOf({
  sqs: [
    {
      sku: 'sqs-requests-standard',
      tiers: [
        ['100000000000', '0.0000004'],
        ['200000000000', '0.0000003'],
        [null, '0.00000024'],
      ],
      freeTier,
    },
    {
      sku: 'sqs-requests-fifo',
      tiers: [
        ['100000000000', '0.0000005'],
        ['200000000000', '0.0000004'],
        [null, '0.00000035'],
      ],
      freeTier,
    },
  ],
});

const input = (queueType: string, requestsPerMonth: number) => ({
  attributes: { queueType },
  usage: { requestsPerMonth },
});
/** Linhas (`sku quantidade valor`) e total em USD do bloco, na franquia e faixa que restam. */
function rate(rater: Rater, block: BlockPriceInput) {
  const lines = rater.rate(priceSqs(block).map((c) => ({ ...c, service: 'sqs' }))) ?? [];
  return {
    lines: lines.map((l) => `${l.sku} ${toFixed(l.quantity, 0)} ${toFixed(l.amount, 2)}`),
    total: toFixed(sum(lines.map((l) => l.amount)), 2),
  };
}

describe('priceSqs', () => {
  it.each([
    ['standard', 1e6, 'sqs-requests-standard'],
    ['fifo', 3e6, 'sqs-requests-fifo'],
    // Uso zero ainda emite a cobrança.
    ['fifo', 0, 'sqs-requests-fifo'],
  ])('cobra as requisições do tipo de fila: %s, %i', (queueType, req, sku) => {
    expect(priceSqs(input(queueType, req))).toStrictEqual([
      { sku, quantity: decimal(req), charge: 'variable' },
    ]);
  });

  it('standard e FIFO dividem a franquia de 1.000.000 de requisições', () => {
    // A padrão usa 600.000; a FIFO paga (600.000 − 400.000) × 0,0000005 = 0,10.
    const rater = createRater(catalog);
    expect(rate(rater, input('standard', 600000)).lines).toEqual(['sqs-requests-standard 0 0.00']);
    expect(rate(rater, input('fifo', 600000)).lines).toEqual(['sqs-requests-fifo 200000 0.10']);
  });

  it('dois blocos padrão no máximo do contrato somam volume e passam à segunda faixa', () => {
    // 1º: (1e11 − 1e6) × 0,0000004 = 39.999,60. 2º: 1.000.000 × 0,0000004 = 0,40 até 1e11 e
    // 99.999.000.000 × 0,0000003 = 29.999,70. Total: 69.999,70.
    const rater = createRater(catalog);
    const [first, second] = [1, 2].map(() => rate(rater, input('standard', 1e11)));
    expect([...first!.lines, ...second!.lines]).toEqual([
      'sqs-requests-standard 99999000000 39999.60',
      'sqs-requests-standard 1000000 0.40',
      'sqs-requests-standard 99999000000 29999.70',
    ]);
    expect(toFixed(sum([first!.total, second!.total].map(decimal)), 2)).toBe('69999.70');
  });

  it.each([
    ['tipo de fila', { queueType: 'fair' }, { requestsPerMonth: 1 }, 'tipo de fila'],
    ['tipo do protótipo', { queueType: 'toString' }, { requestsPerMonth: 1 }, 'tipo de fila'],
    ['tipo ausente', {}, { requestsPerMonth: 1 }, 'tipo de fila'],
    ['uso ausente', { queueType: 'standard' }, {}, 'uso'],
  ])('lança RangeError fora do contrato: %s', (_, attributes, usage, field) => {
    const call = () => priceSqs({ attributes, usage });
    expect(call).toThrow(RangeError);
    expect(call).toThrow(`aws.sqs: ${field} fora do contrato`);
  });
});
