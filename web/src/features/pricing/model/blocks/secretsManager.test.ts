import { describe, expect, it } from 'vitest';
import { decimal, sum, toFixed } from '../../../../shared/lib/money';
import { catalogOf } from '../../../../test/catalogFixtures';
import type { BlockPriceInput } from '../blockContract';
import { createRater } from '../rating';
import { priceSecretsManager } from './secretsManager';

/** Preços de us-east-1 iguais aos da semente, escritos aqui: a semente muda com o catálogo real. */
const catalog = catalogOf({
  'secrets-manager': [
    { sku: 'secrets-manager-secrets', tiers: [[null, '0.4']] },
    { sku: 'secrets-manager-api-requests', tiers: [[null, '0.000005']] },
  ],
});

const input = (secrets: number, apiCallsPerMonth: number) => ({
  attributes: {},
  usage: { secrets, apiCallsPerMonth },
});
/** Linhas (`sku cobrança quantidade valor`) e total em USD do bloco, num rater novo. */
function rate(block: BlockPriceInput) {
  const charges = priceSecretsManager(block).map((c) => ({ ...c, service: 'secrets-manager' }));
  const lines = createRater(catalog).rate(charges);
  // `undefined` é SKU fora do catálogo: falha aqui, em vez de virar total zero.
  if (lines === undefined) throw new Error('cobrança sem preço no catálogo do teste');
  return {
    lines: lines.map(
      (l) => `${l.sku} ${l.charge} ${toFixed(l.quantity, 0)} ${toFixed(l.amount, 2)}`,
    ),
    total: toFixed(sum(lines.map((l) => l.amount)), 2),
  };
}

describe('priceSecretsManager', () => {
  it.each([
    [5, 1e5],
    // Uso zero ainda emite as duas cobranças.
    [0, 0],
  ])('cobra segredos (fixo) e chamadas de API (variável): %i segredos', (secrets, calls) => {
    expect(priceSecretsManager(input(secrets, calls))).toStrictEqual([
      { sku: 'secrets-manager-secrets', quantity: decimal(secrets), charge: 'fixed' },
      { sku: 'secrets-manager-api-requests', quantity: decimal(calls), charge: 'variable' },
    ]);
  });

  it.each([
    // Padrão do contrato, sem franquia: 5 × 0,40 = 2,00 e 100.000 × 0,000005 = 0,50.
    [5, 1e5, ['fixed 5 2.00', 'variable 100000 0.50'], '2.50'],
    // Máximos do contrato: 100.000 × 0,40 = 40.000,00 e 1e11 × 0,000005 = 500.000,00.
    [1e5, 1e11, ['fixed 100000 40000.00', 'variable 100000000000 500000.00'], '540000.00'],
    [0, 0, ['fixed 0 0.00', 'variable 0 0.00'], '0.00'],
  ])('preço de %i segredos e %i chamadas', (secrets, calls, [stored, requests], total) => {
    expect(rate(input(secrets, calls))).toStrictEqual({
      lines: [`secrets-manager-secrets ${stored}`, `secrets-manager-api-requests ${requests}`],
      total,
    });
  });

  it.each([
    ['sem segredos', { apiCallsPerMonth: 1 }],
    ['sem chamadas de API', { secrets: 1 }],
    ['uso vazio', {}],
  ])('lança RangeError fora do contrato: %s', (_, usage) => {
    const call = () => priceSecretsManager({ attributes: {}, usage });
    expect(call).toThrow(RangeError);
    expect(call).toThrow('aws.secrets-manager: uso fora do contrato');
  });
});
