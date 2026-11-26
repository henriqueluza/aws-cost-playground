import { describe, expect, it } from 'vitest';
import { decimal, sum, toFixed, type Decimal } from '../../../../shared/lib/money';
import { catalogOf } from '../../../../test/catalogFixtures';
import type { BlockPriceInput } from '../blockContract';
import { createRater, type Rater } from '../rating';
import { priceRds } from './rds';

/**
 * Preços de us-east-1 iguais aos da semente, escritos aqui: a semente muda com o catálogo real.
 * Sem franquia e sem faixas: o RDS não tem franquia perpétua nem faixas na Price List, e o backup
 * incluído (até 100% do armazenamento) fica fora de `backupStorageGb`, que é só o backup adicional.
 */
const catalog = catalogOf({
  rds: [
    { sku: 'rds-postgres-db.t3.micro-single-az', tiers: [[null, '0.018']] },
    { sku: 'rds-postgres-db.t3.micro-multi-az', tiers: [[null, '0.036']] },
    { sku: 'rds-postgres-db.t3.medium-multi-az', tiers: [[null, '0.145']] },
    { sku: 'rds-mysql-db.r5.large-multi-az', tiers: [[null, '0.48']] },
    { sku: 'rds-postgres-gp3-single-az', tiers: [[null, '0.115']] },
    { sku: 'rds-postgres-gp3-multi-az', tiers: [[null, '0.23']] },
    { sku: 'rds-mysql-gp3-multi-az', tiers: [[null, '0.23']] },
    { sku: 'rds-postgres-backup', tiers: [[null, '0.095']] },
    { sku: 'rds-mysql-backup', tiers: [[null, '0.095']] },
  ],
});

/** Conjunto fechado do contrato (`contracts/blocks.json`), escrito à mão. */
const ENGINES = ['postgres', 'mysql'];
const INSTANCE_CLASSES = [
  'db.t3.micro',
  'db.t3.small',
  'db.t3.medium',
  'db.t4g.micro',
  'db.t4g.small',
  'db.t4g.medium',
  'db.m5.large',
  'db.r5.large',
];
const DEPLOYMENTS = ['single-az', 'multi-az'];

/** Bloco padrão do contrato (postgres, db.t3.micro, single-az, 20 GB, sem backup adicional). */
const ATTRIBUTES = { engine: 'postgres', instanceClass: 'db.t3.micro', deployment: 'single-az' };
const USAGE = { storageGb: 20, backupStorageGb: 0 };
const input = (
  attributes: Record<string, string> = {},
  usage: Record<string, number> = {},
): BlockPriceInput => ({
  attributes: { ...ATTRIBUTES, ...attributes },
  usage: { ...USAGE, ...usage },
});
const charge = (sku: string, quantity: string, kind: 'fixed' | 'variable') => ({
  sku,
  quantity: decimal(quantity),
  charge: kind,
});
/** Linhas (`sku cobrança quantidade valor`) e total em USD do bloco. */
function rate(rater: Rater, block: BlockPriceInput) {
  const lines = rater.rate(priceRds(block).map((c) => ({ ...c, service: 'rds' })));
  // `undefined` é SKU fora do catálogo: falha aqui, em vez de virar total zero.
  if (lines === undefined) throw new Error('cobrança sem preço no catálogo do teste');
  const usd = (value: Decimal) => toFixed(value, 6);
  return {
    lines: lines.map((l) => `${l.sku} ${l.charge} ${usd(l.quantity)} ${usd(l.amount)}`),
    total: usd(sum(lines.map((l) => l.amount))),
  };
}

describe('priceRds', () => {
  const skuCases = ENGINES.flatMap((engine) =>
    INSTANCE_CLASSES.flatMap((instanceClass) =>
      DEPLOYMENTS.map((deployment) => ({ engine, instanceClass, deployment })),
    ),
  );
  // 2 motores × 8 classes × 2 implantações = 32 SKUs de instância.
  it.each(skuCases)(
    'instância e gp3 como custo fixo e backup como variável: $engine $instanceClass $deployment',
    ({ engine, instanceClass, deployment }) => {
      const attributes = { engine, instanceClass, deployment };
      expect(priceRds(input(attributes, { backupStorageGb: 30 }))).toStrictEqual([
        charge(`rds-${engine}-${instanceClass}-${deployment}`, '730', 'fixed'),
        charge(`rds-${engine}-gp3-${deployment}`, '20', 'fixed'),
        charge(`rds-${engine}-backup`, '30', 'variable'),
      ]);
    },
  );

  it.each([
    ['sem backup adicional', 100, 0, '0', '0.000000'],
    // O armazenamento não é descontado: 20 × 0,095 = 1,90, com 20 GB ou com 65.536 GB de disco.
    ['igual ao armazenamento', 20, 20, '20', '1.900000'],
    ['menor que o armazenamento', 65536, 20, '20', '1.900000'],
    // Fração de GB: 5,5 × 0,095 = 0,5225.
    ['5,5 GB', 20, 5.5, '5.5', '0.522500'],
    // 0,1 × 0,095 = 0,0095.
    ['0,1 GB', 20, 0.1, '0.1', '0.009500'],
  ])('backup adicional cobrado inteiro: %s', (_, storageGb, backupStorageGb, backup, usd) => {
    const block = input({}, { storageGb, backupStorageGb });
    expect(priceRds(block)).toStrictEqual([
      charge('rds-postgres-db.t3.micro-single-az', '730', 'fixed'),
      charge('rds-postgres-gp3-single-az', String(storageGb), 'fixed'),
      charge('rds-postgres-backup', backup, 'variable'),
    ]);
    expect(rate(createRater(catalog), block).lines[2]).toBe(
      `rds-postgres-backup variable ${toFixed(decimal(backup), 6)} ${usd}`,
    );
  });

  it('bloco padrão custa 15,44 USD, sem backup pago', () => {
    // 730 × 0,018 = 13,14; 20 × 0,115 = 2,30; backup adicional 0.
    // Total: 13,14 + 2,30 = 15,44.
    expect(rate(createRater(catalog), input())).toStrictEqual({
      lines: [
        'rds-postgres-db.t3.micro-single-az fixed 730.000000 13.140000',
        'rds-postgres-gp3-single-az fixed 20.000000 2.300000',
        'rds-postgres-backup variable 0.000000 0.000000',
      ],
      total: '15.440000',
    });
  });

  it('bloco blk_db do cenário app-clássico custa 128,85 USD', () => {
    // postgres db.t3.medium multi-az, 100 GB, backup 0 (contracts/scenarios/app-classico.json).
    // 730 × 0,145 = 105,85; 100 × 0,23 = 23,00; backup 0. Total: 105,85 + 23,00 = 128,85.
    const block = input(
      { instanceClass: 'db.t3.medium', deployment: 'multi-az', az: 'a' },
      { storageGb: 100, backupStorageGb: 0 },
    );
    expect(rate(createRater(catalog), block)).toStrictEqual({
      lines: [
        'rds-postgres-db.t3.medium-multi-az fixed 730.000000 105.850000',
        'rds-postgres-gp3-multi-az fixed 100.000000 23.000000',
        'rds-postgres-backup variable 0.000000 0.000000',
      ],
      total: '128.850000',
    });
  });

  it('mysql db.r5.large multi-az com 50 GB e backup adicional de 30 GB custa 364,75 USD', () => {
    // 730 × 0,48 = 350,40; 50 × 0,23 = 11,50; 30 × 0,095 = 2,85.
    // Total: 350,40 + 11,50 + 2,85 = 364,75.
    const block = input(
      { engine: 'mysql', instanceClass: 'db.r5.large', deployment: 'multi-az' },
      { storageGb: 50, backupStorageGb: 30 },
    );
    expect(rate(createRater(catalog), block)).toStrictEqual({
      lines: [
        'rds-mysql-db.r5.large-multi-az fixed 730.000000 350.400000',
        'rds-mysql-gp3-multi-az fixed 50.000000 11.500000',
        'rds-mysql-backup variable 30.000000 2.850000',
      ],
      total: '364.750000',
    });
  });

  it('Multi-AZ dobra o custo pelo preço da AWS, não pela quantidade', () => {
    // 730 × 0,036 = 26,28 = 2 × 13,14; 20 × 0,23 = 4,60 = 2 × 2,30. Total: 30,88 = 2 × 15,44.
    const block = input({ deployment: 'multi-az' }, { backupStorageGb: 0 });
    expect(rate(createRater(catalog), block)).toStrictEqual({
      lines: [
        'rds-postgres-db.t3.micro-multi-az fixed 730.000000 26.280000',
        'rds-postgres-gp3-multi-az fixed 20.000000 4.600000',
        'rds-postgres-backup variable 0.000000 0.000000',
      ],
      total: '30.880000',
    });
  });

  it.each(['a', 'b', 'c'])('a zona de disponibilidade %s dá as cobranças de sem zona', (az) => {
    expect(priceRds(input({ deployment: 'multi-az', az }))).toStrictEqual(
      priceRds(input({ deployment: 'multi-az' })),
    );
  });

  it.each([
    ['motor', { ...ATTRIBUTES, engine: 'aurora-postgresql' }, USAGE],
    ['motor', { ...ATTRIBUTES, engine: 'toString' }, USAGE],
    ['classe de instância', { ...ATTRIBUTES, instanceClass: 'cache.t3.small' }, USAGE],
    ['classe de instância', { ...ATTRIBUTES, instanceClass: 'toString' }, USAGE],
    ['implantação', { ...ATTRIBUTES, deployment: 'multi-az-cluster' }, USAGE],
    ['implantação', { ...ATTRIBUTES, deployment: 'toString' }, USAGE],
    ['uso', ATTRIBUTES, { backupStorageGb: USAGE.backupStorageGb }],
    ['uso', ATTRIBUTES, { storageGb: USAGE.storageGb }],
  ])('lança RangeError com %s fora do contrato: %j %j', (field, attributes, usage) => {
    const call = () => priceRds({ attributes, usage });
    expect(call).toThrow(RangeError);
    expect(call).toThrow(`aws.rds: ${field} fora do contrato`);
  });
});
