import { describe, expect, it } from 'vitest';
import blocksFile from '../../../../../../contracts/blocks.json';
import { decimal, sum, toFixed, type Decimal } from '../../../../shared/lib/money';
import { catalogOf, type RawPrice } from '../../../../test/catalogFixtures';
import type { BlockPriceInput } from '../blockContract';
import { createRater } from '../rating';
import { priceElastiCache } from './elasticache';

/** USD por nó-hora em us-east-1, iguais aos da semente e escritos aqui; Redis = Memcached. */
const HOURLY = {
  'cache.t3.micro': '0.017',
  'cache.t3.small': '0.034',
  'cache.t3.medium': '0.068',
  'cache.t4g.micro': '0.016',
  'cache.t4g.small': '0.032',
  'cache.t4g.medium': '0.065',
  'cache.m5.large': '0.156',
  'cache.r5.large': '0.216',
};
const catalog = catalogOf({
  elasticache: ['redis', 'memcached'].flatMap((engine) =>
    Object.entries(HOURLY).map(([nodeType, price]): RawPrice => ({
      sku: `elasticache-${engine}-${nodeType}`,
      tiers: [[null, price]],
    })),
  ),
});
const SKUS = catalog.services.get('elasticache')?.prices.map((price) => price.sku) ?? [];

/** Motores e tipos de nó lidos do contrato: o teste quebra se a lista mudar sem o catálogo. */
type ContractBlock = { type: string; attributes: { key: string; options?: unknown[] }[] };
const contract = (blocksFile.blocks as ContractBlock[]).find((b) => b.type === 'aws.elasticache');
const options = (key: string) =>
  (contract?.attributes.find((attribute) => attribute.key === key)?.options ?? []).map(String);
const combinations = options('engine').flatMap((e) => options('nodeType').map((n) => [e, n]));

const input = (engine: string, nodeType: string, nodeCount?: number, az?: string) => {
  const block: BlockPriceInput = {
    attributes: { engine, nodeType, ...(az === undefined ? {} : { az }) },
    usage: nodeCount === undefined ? {} : { nodeCount },
  };
  return block;
};
const fixed = (engine: string, nodeType: string, hours: string) => [
  { sku: `elasticache-${engine}-${nodeType}`, quantity: decimal(hours), charge: 'fixed' },
];
/** Linhas (`sku cobrança quantidade valor`) e total em USD do bloco. */
function rate(block: BlockPriceInput) {
  const charges = priceElastiCache(block).map((c) => ({ ...c, service: 'elasticache' }));
  const lines = createRater(catalog).rate(charges);
  // `undefined` é SKU fora do catálogo: falha aqui, em vez de virar total zero.
  if (lines === undefined) throw new Error('cobrança sem preço no catálogo do teste');
  const usd = (value: Decimal) => toFixed(value, 6);
  return {
    lines: lines.map((l) => `${l.sku} ${l.charge} ${usd(l.quantity)} ${usd(l.amount)}`),
    total: usd(sum(lines.map((l) => l.amount))),
  };
}

describe('priceElastiCache', () => {
  it.each([
    // Cenário app-classico: 2 nós × 730 h = 1.460 h × 0,034 = 49,64.
    ['redis', 'cache.t3.small', 2, '1460', '49.640000'],
    // Padrão do contrato: 1 nó × 730 h = 730 h × 0,017 = 12,41.
    ['redis', 'cache.t3.micro', 1, '730', '12.410000'],
    // 3 nós × 730 h = 2.190 h × 0,216 = 473,04.
    ['memcached', 'cache.r5.large', 3, '2190', '473.040000'],
    // Máximo do contrato: 500 × 730 = 365.000 h × 0,065 = 23.725. Linear: o catálogo do ElastiCache
    // não tem franquia permanente (a de 12 meses não é modelada) nem troca de faixa.
    ['redis', 'cache.t4g.medium', 500, '365000', '23725.000000'],
  ])('%s %s × %i nós cobra nó-hora fixo', (engine, nodeType, nodes, hours, usd) => {
    expect(rate(input(engine, nodeType, nodes))).toStrictEqual({
      lines: [`elasticache-${engine}-${nodeType} fixed ${hours}.000000 ${usd}`],
      total: usd,
    });
  });

  it('o contrato tem as 16 combinações do catálogo', () => {
    expect(combinations).toHaveLength(16);
    expect(SKUS).toHaveLength(16);
  });

  it.each(combinations)('%s %s: uma cobrança fixa de 730 h por nó, com SKU do catálogo', (e, n) => {
    // 2 nós × 730 h = 1.460 h.
    expect(priceElastiCache(input(e, n, 2))).toStrictEqual(fixed(e, n, '1460'));
    expect(SKUS).toContain(`elasticache-${e}-${n}`);
  });

  it.each([
    [1, '730'],
    // 7 nós × 730 h = 5.110 h.
    [7, '5110'],
  ])('quantidade proporcional ao número de nós: %i', (nodes, hours) => {
    expect(priceElastiCache(input('redis', 'cache.t3.medium', nodes))).toStrictEqual(
      fixed('redis', 'cache.t3.medium', hours),
    );
  });

  it.each(['a', 'b', 'c', undefined])('a zona %s não muda a cobrança', (az) => {
    // 2 nós × 730 h = 1.460 h × 0,156 = 227,76.
    expect(rate(input('memcached', 'cache.m5.large', 2, az)).total).toBe('227.760000');
  });

  it.each([
    ['motor valkey', input('valkey', 'cache.t3.micro', 1), 'motor ou tipo de nó'],
    ['motor do protótipo', input('toString', 'cache.t3.micro', 1), 'motor ou tipo de nó'],
    ['tipo de nó fora da lista', input('redis', 'cache.t2.micro', 1), 'motor ou tipo de nó'],
    ['tipo de nó do protótipo', input('redis', 'constructor', 1), 'motor ou tipo de nó'],
    ['sem nodeCount', input('redis', 'cache.t3.micro'), 'uso'],
  ])('lança RangeError fora do contrato: %s', (_, block, field) => {
    const call = () => priceElastiCache(block);
    expect(call).toThrow(RangeError);
    expect(call).toThrow(`aws.elasticache: ${field} fora do contrato`);
  });
});
