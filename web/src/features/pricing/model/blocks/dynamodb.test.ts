import { describe, expect, it } from 'vitest';
import { decimal, sum, toFixed, type Decimal } from '../../../../shared/lib/money';
import { catalogOf } from '../../../../test/catalogFixtures';
import type { BlockPriceInput } from '../blockContract';
import { createRater, type Rater } from '../rating';
import { priceDynamoDb } from './dynamodb';

/** Preços de us-east-1 iguais aos da semente, escritos aqui: a semente muda com o catálogo real. */
const catalog = catalogOf({
  dynamodb: [
    { sku: 'dynamodb-read-requests', tiers: [[null, '0.000000125']] },
    { sku: 'dynamodb-write-requests', tiers: [[null, '0.000000625']] },
    { sku: 'dynamodb-read-capacity', tiers: [[null, '0.00013']], freeTier: { quantity: '18600' } },
    { sku: 'dynamodb-write-capacity', tiers: [[null, '0.00065']], freeTier: { quantity: '18600' } },
    { sku: 'dynamodb-storage', tiers: [[null, '0.25']], freeTier: { quantity: '25' } },
  ],
});

/** Cada modo recebe só as próprias chaves de uso: as do outro modo podem faltar. */
const OD = { capacityMode: 'on-demand' };
const PR = { capacityMode: 'provisioned' };
const onDemand = (reads: number, writes: number, storageGb: number) => ({
  attributes: OD,
  usage: { readRequestsPerMonth: reads, writeRequestsPerMonth: writes, storageGb },
});
const provisioned = (rcu: number, wcu: number, storageGb: number) => ({
  attributes: PR,
  usage: { provisionedReadUnits: rcu, provisionedWriteUnits: wcu, storageGb },
});
const charge = (sku: string, quantity: string, kind: 'fixed' | 'variable') => ({
  sku: `dynamodb-${sku}`,
  quantity: decimal(quantity),
  charge: kind,
});
/** Linhas (`sku cobrança quantidade valor`) e total em USD do bloco, na franquia que resta. */
function rate(rater: Rater, block: BlockPriceInput) {
  const lines = rater.rate(priceDynamoDb(block).map((c) => ({ ...c, service: 'dynamodb' }))) ?? [];
  const usd = (value: Decimal) => toFixed(value, 6);
  return {
    lines: lines.map((l) => `${l.sku} ${l.charge} ${usd(l.quantity)} ${usd(l.amount)}`),
    total: usd(sum(lines.map((l) => l.amount))),
  };
}

describe('priceDynamoDb', () => {
  it.each([
    [1e6, 5e5, 12.5, '1000000', '500000', '12.5'],
    // Uso zero ainda emite as três cobranças.
    [0, 0, 0, '0', '0', '0'],
  ])('sob demanda cobra requisições e GB: %i leituras', (r, w, gb, reads, writes, storage) => {
    expect(priceDynamoDb(onDemand(r, w, gb))).toStrictEqual([
      charge('read-requests', reads, 'variable'),
      charge('write-requests', writes, 'variable'),
      charge('storage', storage, 'variable'),
    ]);
  });

  it.each([
    // Capacidade-hora = unidades × 730 h: 100 × 730 = 73.000.
    [100, 100, 12.5, '73000', '73000', '12.5'],
    [0, 0, 0, '0', '0', '0'],
  ])('provisionado cobra capacidade fixa: %i RCU', (rcu, wcu, gb, reads, writes, storage) => {
    expect(priceDynamoDb(provisioned(rcu, wcu, gb))).toStrictEqual([
      charge('read-capacity', reads, 'fixed'),
      charge('write-capacity', writes, 'fixed'),
      charge('storage', storage, 'variable'),
    ]);
  });

  it('lê só as chaves do modo ativo', () => {
    const usage = { ...onDemand(1, 2, 3).usage, ...provisioned(4, 5, 3).usage };
    expect(priceDynamoDb({ attributes: OD, usage })).toStrictEqual([
      charge('read-requests', '1', 'variable'),
      charge('write-requests', '2', 'variable'),
      charge('storage', '3', 'variable'),
    ]);
    // 4 × 730 = 2.920 e 5 × 730 = 3.650.
    expect(priceDynamoDb({ attributes: PR, usage })).toStrictEqual([
      charge('read-capacity', '2920', 'fixed'),
      charge('write-capacity', '3650', 'fixed'),
      charge('storage', '3', 'variable'),
    ]);
  });

  it('sob demanda: requisições sem franquia e armazenamento além de 25 GB', () => {
    // 1.000.000 × 0,000000125 = 0,125; 500.000 × 0,000000625 = 0,3125; (30 − 25) × 0,25 = 1,25.
    expect(rate(createRater(catalog), onDemand(1e6, 5e5, 30))).toStrictEqual({
      lines: [
        'dynamodb-read-requests variable 1000000.000000 0.125000',
        'dynamodb-write-requests variable 500000.000000 0.312500',
        'dynamodb-storage variable 5.000000 1.250000',
      ],
      total: '1.687500',
    });
  });

  it.each([
    [5, '0.000000'],
    // Limite da franquia, a única troca de faixa do DynamoDB: 25 GB grátis; 0,5 × 0,25 = 0,125.
    [25, '0.000000'],
    [25.5, '0.125000'],
  ])('desconta a franquia de 25 GB de armazenamento: %s GB', (gb, total) => {
    expect(rate(createRater(catalog), onDemand(0, 0, gb)).total).toBe(total);
  });

  it('provisionado desconta 18.600 unidades-hora de leitura e de escrita', () => {
    // 100 × 730 = 73.000 − 18.600 = 54.400: × 0,00013 = 7,072 e × 0,00065 = 35,36.
    expect(rate(createRater(catalog), provisioned(100, 100, 30))).toStrictEqual({
      lines: [
        'dynamodb-read-capacity fixed 54400.000000 7.072000',
        'dynamodb-write-capacity fixed 54400.000000 35.360000',
        'dynamodb-storage variable 5.000000 1.250000',
      ],
      total: '43.682000',
    });
  });

  it('25 RCU e 25 WCU cabem na franquia', () => {
    // 25 × 730 = 18.250 unidades-hora ≤ 18.600.
    expect(rate(createRater(catalog), provisioned(25, 25, 0)).total).toBe('0.000000');
  });

  it('dois blocos provisionados dividem a franquia de capacidade', () => {
    // 20 × 730 = 14.600: o 1º usa 14.600 de 18.600; o 2º paga (14.600 − 4.000) × 0,00013 = 1,378.
    const rater = createRater(catalog);
    expect(rate(rater, provisioned(20, 0, 0)).total).toBe('0.000000');
    expect(rate(rater, provisioned(20, 0, 0)).lines[0]).toBe(
      'dynamodb-read-capacity fixed 10600.000000 1.378000',
    );
  });

  const full = { ...onDemand(1, 1, 1).usage, ...provisioned(1, 1, 1).usage };
  it.each([
    ['modo inválido', { capacityMode: 'serverless' }, '', 'modo de capacidade'],
    ['modo do protótipo', { capacityMode: 'toString' }, '', 'modo de capacidade'],
    ['modo ausente', {}, '', 'modo de capacidade'],
    ['sem escritas no sob demanda', OD, 'writeRequestsPerMonth', 'uso'],
    ['sem RCU no provisionado', PR, 'provisionedReadUnits', 'uso'],
    ['sem armazenamento', PR, 'storageGb', 'uso'],
  ])('lança RangeError fora do contrato: %s', (_, attributes, missing, field) => {
    const usage = Object.fromEntries(Object.entries(full).filter(([key]) => key !== missing));
    const call = () => priceDynamoDb({ attributes, usage });
    expect(call).toThrow(RangeError);
    expect(call).toThrow(`aws.dynamodb: ${field} fora do contrato`);
  });
});
