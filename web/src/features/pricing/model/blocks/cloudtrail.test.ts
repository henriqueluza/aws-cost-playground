import { describe, expect, it } from 'vitest';
import { decimal, sum, toFixed } from '../../../../shared/lib/money';
import { catalogOf } from '../../../../test/catalogFixtures';
import type { BlockPriceInput } from '../blockContract';
import { createRater } from '../rating';
import { priceCloudTrail } from './cloudtrail';

/**
 * Preços de us-east-1 iguais aos da semente, escritos aqui: a semente muda com o catálogo real.
 * O CloudTrail não tem franquia nem troca de faixa no catálogo: o grátis é a 1ª trilha, que a
 * função de preço já tira da quantidade de eventos de gerenciamento.
 */
const catalog = catalogOf({
  cloudtrail: [
    { sku: 'cloudtrail-management-events', tiers: [[null, '0.00002']] },
    { sku: 'cloudtrail-data-events', tiers: [[null, '0.000001']] },
  ],
});

const input = (trails: number, managementEventsPerMonth: number, dataEventsPerMonth: number) => ({
  attributes: {},
  usage: { trails, managementEventsPerMonth, dataEventsPerMonth },
});
/** Linhas (`sku quantidade valor`) e total em USD do bloco; cada chamada usa um `Rater` novo. */
function rate(block: BlockPriceInput) {
  const charges = priceCloudTrail(block).map((c) => ({ ...c, service: 'cloudtrail' }));
  const lines = createRater(catalog).rate(charges) ?? [];
  return {
    lines: lines.map((l) => `${l.sku} ${toFixed(l.quantity, 0)} ${toFixed(l.amount, 2)}`),
    total: toFixed(sum(lines.map((l) => l.amount)), 2),
  };
}

describe('priceCloudTrail', () => {
  it.each([
    // Uma trilha: a cópia de gerenciamento grátis cobre tudo; uso zero ainda emite as duas linhas.
    [1, 100000, 0, 0, 0],
    [3, 1e6, 5e6, 2e6, 5e6],
    [5, 1e11, 1e11, 4e11, 1e11],
  ])(
    '%i trilhas, %i de gerenciamento e %i de dados: cobra as cópias adicionais e os dados',
    (trails, management, data, managementQty, dataQty) => {
      expect(priceCloudTrail(input(trails, management, data))).toStrictEqual([
        {
          sku: 'cloudtrail-management-events',
          quantity: decimal(managementQty),
          charge: 'variable',
        },
        { sku: 'cloudtrail-data-events', quantity: decimal(dataQty), charge: 'variable' },
      ]);
    },
  );

  it('a primeira trilha não paga eventos de gerenciamento', () => {
    // (1 − 1) × 100.000 = 0 eventos: 0,00; 0 eventos de dados: 0,00.
    expect(rate(input(1, 100000, 0))).toStrictEqual({
      lines: ['cloudtrail-management-events 0 0.00', 'cloudtrail-data-events 0 0.00'],
      total: '0.00',
    });
  });

  it('cobra as cópias além da primeira trilha e todos os eventos de dados', () => {
    // (3 − 1) × 1.000.000 = 2.000.000 × 0,00002 = 40,00; 5.000.000 × 0,000001 = 5,00.
    expect(rate(input(3, 1e6, 5e6))).toStrictEqual({
      lines: ['cloudtrail-management-events 2000000 40.00', 'cloudtrail-data-events 5000000 5.00'],
      total: '45.00',
    });
  });

  it('no máximo do contrato soma sem perder precisão', () => {
    // (5 − 1) × 1e11 = 4e11 × 0,00002 = 8.000.000,00; 1e11 × 0,000001 = 100.000,00.
    expect(rate(input(5, 1e11, 1e11))).toStrictEqual({
      lines: [
        'cloudtrail-management-events 400000000000 8000000.00',
        'cloudtrail-data-events 100000000000 100000.00',
      ],
      total: '8100000.00',
    });
  });

  const ok = { trails: 1, managementEventsPerMonth: 1, dataEventsPerMonth: 1 };
  it.each(Object.keys(ok))('lança RangeError fora do contrato: uso sem %s', (key) => {
    const usage = Object.fromEntries(Object.entries(ok).filter(([k]) => k !== key));
    const call = () => priceCloudTrail({ attributes: {}, usage });
    expect(call).toThrow(RangeError);
    expect(call).toThrow('aws.cloudtrail: uso fora do contrato');
  });

  it('lança RangeError fora do contrato: 0 trilhas', () => {
    const call = () => priceCloudTrail(input(0, 1, 1));
    expect(call).toThrow(RangeError);
    expect(call).toThrow('aws.cloudtrail: uso fora do contrato');
  });
});
