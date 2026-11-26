import { describe, expect, it } from 'vitest';
import { decimal, sum, toFixed } from '../../../../shared/lib/money';
import { catalogOf } from '../../../../test/catalogFixtures';
import type { BlockPriceInput } from '../blockContract';
import { createRater, type Rater } from '../rating';
import { priceCognito } from './cognito';

/** Preços de us-east-1 iguais aos da semente, escritos aqui: a semente muda com o catálogo real. */
const freeTier = { quantity: '10000', pool: 'cognito-mau' };
const catalog = catalogOf({
  cognito: [
    {
      sku: 'cognito-mau-lite',
      tiers: [
        ['90000', '0.0055'],
        ['990000', '0.0046'],
        ['9990000', '0.00325'],
        [null, '0.0025'],
      ],
      freeTier,
    },
    { sku: 'cognito-mau-essentials', tiers: [[null, '0.015']], freeTier },
    { sku: 'cognito-mau-plus', tiers: [[null, '0.02']] },
  ],
});

const input = (tier: string, monthlyActiveUsers: number) => ({
  attributes: { tier },
  usage: { monthlyActiveUsers },
});
/** Linhas (`sku quantidade valor`) e total em USD do bloco, na franquia e faixa que restam. */
function rate(rater: Rater, block: BlockPriceInput) {
  const lines = rater.rate(priceCognito(block).map((c) => ({ ...c, service: 'cognito' })));
  // `undefined` é SKU fora do catálogo: falha aqui, em vez de virar total zero.
  if (lines === undefined) throw new Error('cobrança sem preço no catálogo do teste');
  return {
    lines: lines.map((l) => `${l.sku} ${toFixed(l.quantity, 0)} ${toFixed(l.amount, 2)}`),
    total: toFixed(sum(lines.map((l) => l.amount)), 2),
  };
}

describe('priceCognito', () => {
  it.each([
    ['lite', 1000, 'cognito-mau-lite'],
    ['essentials', 25000, 'cognito-mau-essentials'],
    ['plus', 1000, 'cognito-mau-plus'],
    // Uso zero ainda emite a cobrança.
    ['essentials', 0, 'cognito-mau-essentials'],
  ])('cobra os usuários ativos mensais do tier: %s, %i', (tier, mau, sku) => {
    expect(priceCognito(input(tier, mau))).toStrictEqual([
      { sku, quantity: decimal(mau), charge: 'variable' },
    ]);
  });

  it.each([
    // Franquia inteira: 10.000 MAU grátis, a linha zerada mostra o SKU.
    ['lite', 10000, ['cognito-mau-lite 0 0.00'], '0.00'],
    // Limite da 1ª faixa: (100.000 − 10.000) × 0,0055 = 495,00, sem linha da 2ª.
    ['lite', 100000, ['cognito-mau-lite 90000 495.00'], '495.00'],
    // Troca de faixa: 495,00 + (1.000.000 − 100.000) × 0,0046 = 495 + 4.140 = 4.635,00.
    ['lite', 1e6, ['cognito-mau-lite 90000 495.00', 'cognito-mau-lite 900000 4140.00'], '4635.00'],
    // Máximo do contrato: 495 + 4.140 + 9.000.000 × 0,00325 + 90.000.000 × 0,0025
    // = 495 + 4.140 + 29.250 + 225.000 = 258.885,00.
    [
      'lite',
      1e8,
      [
        'cognito-mau-lite 90000 495.00',
        'cognito-mau-lite 900000 4140.00',
        'cognito-mau-lite 9000000 29250.00',
        'cognito-mau-lite 90000000 225000.00',
      ],
      '258885.00',
    ],
    ['essentials', 10000, ['cognito-mau-essentials 0 0.00'], '0.00'],
    // (25.000 − 10.000) × 0,015 = 225,00.
    ['essentials', 25000, ['cognito-mau-essentials 15000 225.00'], '225.00'],
    // Plus não tem franquia: 1.000 × 0,02 = 20,00.
    ['plus', 1000, ['cognito-mau-plus 1000 20.00'], '20.00'],
  ])('desconta a franquia e aplica as faixas: %s, %i MAU', (tier, mau, lines, total) => {
    expect(rate(createRater(catalog), input(tier, mau))).toStrictEqual({ lines, total });
  });

  it('Lite e Essentials dividem a franquia de 10.000 MAU', () => {
    // O Lite usa 6.000 de 10.000; o Essentials paga (6.000 − 4.000) × 0,015 = 30,00.
    const rater = createRater(catalog);
    expect(rate(rater, input('lite', 6000)).lines).toEqual(['cognito-mau-lite 0 0.00']);
    expect(rate(rater, input('essentials', 6000)).lines).toEqual([
      'cognito-mau-essentials 2000 30.00',
    ]);
  });

  it('Plus não consome a franquia dos outros tiers', () => {
    // 1.000 × 0,02 = 20,00; os 10.000 MAU do Essentials depois dele seguem grátis.
    const rater = createRater(catalog);
    expect(rate(rater, input('plus', 1000)).total).toBe('20.00');
    expect(rate(rater, input('essentials', 10000)).lines).toEqual([
      'cognito-mau-essentials 0 0.00',
    ]);
  });

  it('dois blocos Lite somam volume e o segundo passa à segunda faixa', () => {
    // 1º: (60.000 − 10.000) × 0,0055 = 275,00. 2º: 40.000 × 0,0055 = 220,00 até 90.000 cobrados
    // e 20.000 × 0,0046 = 92,00. Total do 2º: 312,00.
    const rater = createRater(catalog);
    expect(rate(rater, input('lite', 60000))).toStrictEqual({
      lines: ['cognito-mau-lite 50000 275.00'],
      total: '275.00',
    });
    expect(rate(rater, input('lite', 60000))).toStrictEqual({
      lines: ['cognito-mau-lite 40000 220.00', 'cognito-mau-lite 20000 92.00'],
      total: '312.00',
    });
  });

  it.each([
    ['tier inválido', { tier: 'enterprise' }, { monthlyActiveUsers: 1 }, 'tier'],
    ['tier do protótipo', { tier: 'toString' }, { monthlyActiveUsers: 1 }, 'tier'],
    ['tier ausente', {}, { monthlyActiveUsers: 1 }, 'tier'],
    ['uso ausente', { tier: 'lite' }, {}, 'uso'],
  ])('lança RangeError fora do contrato: %s', (_, attributes, usage, field) => {
    const call = () => priceCognito({ attributes, usage });
    expect(call).toThrow(RangeError);
    expect(call).toThrow(`aws.cognito: ${field} fora do contrato`);
  });
});
