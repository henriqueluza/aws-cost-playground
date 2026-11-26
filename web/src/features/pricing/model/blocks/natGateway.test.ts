import { describe, expect, it } from 'vitest';
import { decimal, sum, toFixed, type Decimal } from '../../../../shared/lib/money';
import { catalogOf } from '../../../../test/catalogFixtures';
import type { BlockPriceInput } from '../blockContract';
import { createRater, type Rater } from '../rating';
import { priceNatGateway } from './natGateway';

/** Preços de us-east-1 iguais aos da semente, escritos aqui: sem franquia e sem faixas. */
const catalog = catalogOf({
  'nat-gateway': [
    { sku: 'nat-gateway-hours', tiers: [[null, '0.045']] },
    { sku: 'nat-gateway-data-processed', tiers: [[null, '0.045']] },
  ],
});

const input = (processedGbPerMonth: number) => ({ attributes: {}, usage: { processedGbPerMonth } });
/** Linhas (`sku cobrança quantidade valor`) e total em USD do bloco. */
function rate(rater: Rater, block: BlockPriceInput) {
  const charges = priceNatGateway(block).map((c) => ({ ...c, service: 'nat-gateway' }));
  const lines = rater.rate(charges);
  // `undefined` é SKU fora do catálogo: falha aqui, em vez de virar total zero.
  if (lines === undefined) throw new Error('cobrança sem preço no catálogo do teste');
  const usd = (value: Decimal) => toFixed(value, 6);
  return {
    lines: lines.map((l) => `${l.sku} ${l.charge} ${usd(l.quantity)} ${usd(l.amount)}`),
    total: usd(sum(lines.map((l) => l.amount))),
  };
}

describe('priceNatGateway', () => {
  it.each([
    [50, '50'],
    [0.5, '0.5'],
    // Uso zero ainda emite as duas cobranças.
    [0, '0'],
  ])('cobra 730 h fixas e o GB processado variável: %s GB', (gb, processed) => {
    expect(priceNatGateway(input(gb))).toStrictEqual([
      { sku: 'nat-gateway-hours', quantity: decimal('730'), charge: 'fixed' },
      { sku: 'nat-gateway-data-processed', quantity: decimal(processed), charge: 'variable' },
    ]);
  });

  it('cenário 2: 50 GB processados', () => {
    // 730 × 0,045 = 32,85; 50 × 0,045 = 2,25.
    expect(rate(createRater(catalog), input(50))).toStrictEqual({
      lines: [
        'nat-gateway-hours fixed 730.000000 32.850000',
        'nat-gateway-data-processed variable 50.000000 2.250000',
      ],
      total: '35.100000',
    });
  });

  it.each([
    // Sem franquia: o gateway parado paga as 730 h.
    [0, '32.850000'],
    // O primeiro GB já é cobrado: 32,85 + 1 × 0,045 = 32,895.
    [1, '32.895000'],
  ])('cobra desde a primeira unidade: %i GB', (gb, total) => {
    expect(rate(createRater(catalog), input(gb)).total).toBe(total);
  });

  it('dois gateways pagam cada um as próprias horas e GB', () => {
    // Sem faixas nem franquia, o segundo paga o mesmo que o primeiro: 2 × 35,10 = 70,20.
    const rater = createRater(catalog);
    const totals = [1, 2].map(() => rate(rater, input(50)).total);
    expect(totals).toStrictEqual(['35.100000', '35.100000']);
  });

  it.each([
    ['uso ausente', {}],
    ['só chaves do protótipo', { toString: 1, valueOf: 1, constructor: 1 }],
  ])('lança RangeError fora do contrato: %s', (_, usage) => {
    const call = () => priceNatGateway({ attributes: {}, usage });
    expect(call).toThrow(RangeError);
    expect(call).toThrow('aws.nat-gateway: uso fora do contrato');
  });
});
