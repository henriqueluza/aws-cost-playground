import { describe, expect, it } from 'vitest';
import { decimal, sum, toFixed } from '../../../shared/lib/money';
import { catalogOf, type RawPrice } from '../../../test/catalogFixtures';
import type { CostLine } from './engine';
import { createRater, type ServiceCharge } from './rating';

const charge = (sku: string, quantity: string | number, service = 'svc'): ServiceCharge => ({
  service,
  sku,
  quantity: decimal(quantity),
  charge: 'variable',
});
const trim = (text: string) => text.replace(/\.?0+$/, '');
/** `quantidade × preço = valor` de cada linha, sem zeros à direita. */
const show = (lines: readonly CostLine[] | undefined) =>
  lines?.map((l) => [l.quantity, l.unitPrice, l.amount].map((v) => trim(toFixed(v, 12))).join(' '));
const total = (lines: readonly CostLine[] | undefined) =>
  trim(toFixed(sum((lines ?? []).map((line) => line.amount)), 12));

/** Faixas: até 10 a 1; de 10 a 30 a 0.5; acima de 30 a 0.1. */
const tiered: RawPrice = {
  sku: 'tiered',
  tiers: [
    ['10', '1'],
    ['30', '0.5'],
    [null, '0.1'],
  ],
};

describe('faixas de preço por volume', () => {
  it.each([
    ['dentro da primeira faixa', '4', ['4 1 4']],
    ['exatamente no limite da primeira', '10', ['10 1 10']],
    [
      'um passo além do limite',
      '10.000000000002',
      ['10 1 10', '0.000000000002 0.5 0.000000000001'],
    ],
    ['atravessando duas faixas', '25', ['10 1 10', '15 0.5 7.5']],
    ['exatamente no limite da segunda', '30', ['10 1 10', '20 0.5 10']],
    ['atravessando três faixas', '45.5', ['10 1 10', '20 0.5 10', '15.5 0.1 1.55']],
  ])('%s', (_, quantity, expected) => {
    const rater = createRater(catalogOf({ svc: [tiered] }));
    expect(show(rater.rate([charge('tiered', quantity)]))).toEqual(expected);
  });

  it('gera uma linha por faixa usada, com o SKU e a classificação da cobrança', () => {
    const rater = createRater(catalogOf({ svc: [tiered] }));
    const lines = rater.rate([{ ...charge('tiered', 25), charge: 'fixed' }]);
    expect(lines?.map((line) => [line.sku, line.charge])).toEqual(
      Array(2).fill(['tiered', 'fixed']),
    );
  });

  it('soma o volume do mesmo SKU entre itens: o segundo continua de onde o primeiro parou', () => {
    const rater = createRater(catalogOf({ svc: [tiered] }));
    expect(show(rater.rate([charge('tiered', 8)]))).toEqual(['8 1 8']);
    expect(show(rater.rate([charge('tiered', 8)]))).toEqual(['2 1 2', '6 0.5 3']);
    expect(show(rater.rate([charge('tiered', 14)]))).toEqual(['14 0.5 7']);
    expect(show(rater.rate([charge('tiered', 1)]))).toEqual(['1 0.1 0.1']);
  });

  it('não mistura o volume de SKUs iguais de serviços diferentes', () => {
    const rater = createRater(catalogOf({ svc: [tiered], other: [tiered] }));
    rater.rate([charge('tiered', 10)]);
    expect(show(rater.rate([charge('tiered', 1, 'other')]))).toEqual(['1 1 1']);
  });
});

describe('franquia gratuita', () => {
  const free: RawPrice = { ...tiered, sku: 'free', freeTier: { quantity: '100' } };

  it.each([
    ['uso menor que a franquia: linha zerada', '40', ['0 1 0']],
    ['uso igual à franquia', '100', ['0 1 0']],
    ['uso acima: as faixas contam depois da franquia', '125', ['10 1 10', '15 0.5 7.5']],
    ['uso zero', '0', ['0 1 0']],
  ])('%s', (_, quantity, expected) => {
    const rater = createRater(catalogOf({ svc: [free] }));
    expect(show(rater.rate([charge('free', quantity)]))).toEqual(expected);
  });

  it('é da conta: dois itens do mesmo SKU dividem uma franquia só', () => {
    const rater = createRater(catalogOf({ svc: [free] }));
    expect(show(rater.rate([charge('free', 70)]))).toEqual(['0 1 0']);
    expect(show(rater.rate([charge('free', 70)]))).toEqual(['10 1 10', '20 0.5 10', '10 0.1 1']);
  });

  it('em pool é dividida entre SKUs e blocos, na ordem do design', () => {
    const pool = { quantity: '100', pool: 'shared' };
    const catalog = catalogOf({
      svc: [{ sku: 'a', tiers: [[null, '2']], freeTier: pool }],
      other: [{ sku: 'b', tiers: [[null, '3']], freeTier: pool }],
    });
    const rater = createRater(catalog);
    expect(show(rater.rate([charge('a', 60)]))).toEqual(['0 2 0']);
    expect(show(rater.rate([charge('b', 60, 'other')]))).toEqual(['20 3 60']);
    expect(show(rater.rate([charge('a', 5)]))).toEqual(['5 2 10']);
  });

  it('em pool com quantidades divergentes vale a menor, em qualquer ordem', () => {
    const catalog = catalogOf({
      svc: [
        { sku: 'a', freeTier: { quantity: '100', pool: 'shared' } },
        { sku: 'b', freeTier: { quantity: '30', pool: 'shared' } },
      ],
    });
    expect(show(createRater(catalog).rate([charge('a', 50)]))).toEqual(['20 1 20']);
    expect(show(createRater(catalog).rate([charge('b', 50)]))).toEqual(['20 1 20']);
  });
});

describe('quantidade mínima', () => {
  const minimum: RawPrice = { sku: 'min', tiers: [[null, '2']], minimumQuantity: '1' };

  it.each([
    ['abaixo do mínimo cobra o mínimo', '0.4', ['1 2 2']],
    ['no mínimo', '1', ['1 2 2']],
    ['acima do mínimo', '1.5', ['1.5 2 3']],
    ['zero não cobra o mínimo', '0', ['0 2 0']],
  ])('%s', (_, quantity, expected) => {
    const rater = createRater(catalogOf({ svc: [minimum] }));
    expect(show(rater.rate([charge('min', quantity)]))).toEqual(expected);
  });

  it('vale antes da franquia', () => {
    const price = { ...minimum, minimumQuantity: '10', freeTier: { quantity: '4' } };
    const rater = createRater(catalogOf({ svc: [price] }));
    expect(show(rater.rate([charge('min', 3)]))).toEqual(['6 2 12']);
  });
});

describe('preço indisponível', () => {
  const free: RawPrice = { sku: 'free', freeTier: { quantity: '10' } };

  it.each([
    ['SKU ausente', charge('missing', 1)],
    ['serviço não carregado', charge('free', 1, 'unloaded')],
    ['quantidade negativa', charge('free', -1)],
    ['nome de propriedade herdada', charge('constructor', 1)],
  ])('%s: devolve undefined', (_, bad) => {
    expect(createRater(catalogOf({ svc: [free] })).rate([bad])).toBeUndefined();
  });

  it('não consome franquia nem faixa das cobranças vizinhas do item recusado', () => {
    const rater = createRater(catalogOf({ svc: [free] }));
    expect(rater.rate([charge('free', 10), charge('missing', 1)])).toBeUndefined();
    expect(show(rater.rate([charge('free', 10)]))).toEqual(['0 1 0']);
  });

  it('item sem cobranças tem preço: nenhuma linha', () => {
    expect(createRater(catalogOf({})).rate([])).toEqual([]);
  });
});

describe('exatidão', () => {
  it.each([
    ['1000000000000', '0.000000000001', '1'],
    ['1000000000000', '0.123456789012', '123456789012'],
    ['999999999999.999999999999', '1', '999999999999.999999999999'],
    ['730000000000000', '999999999999999.999999999999', '729999999999999999999999999270'],
  ])('%s × %s = %s, sem perda', (quantity, unitPrice, amount) => {
    const rater = createRater(catalogOf({ svc: [{ sku: 'big', tiers: [[null, unitPrice]] }] }));
    expect(total(rater.rate([charge('big', quantity)]))).toBe(amount);
  });

  it('arredonda o valor de cada linha meio-para-par na 12ª casa', () => {
    const rater = createRater(catalogOf({ svc: [{ sku: 'p', tiers: [[null, '0.000001']] }] }));
    expect(total(rater.rate([charge('p', '0.0000025')]))).toBe('0.000000000002');
    expect(total(rater.rate([charge('p', '0.0000035')]))).toBe('0.000000000004');
  });

  it('dividir uma quantidade entre itens não muda o total nem a quantidade cobrada', () => {
    const price = { ...tiered, freeTier: { quantity: '7' } };
    let seed = 20261125;
    const next = (max: number) => (seed = (seed * 1103515245 + 12345) % 2147483648) % max;
    for (let round = 0; round < 200; round += 1) {
      const parts = Array.from({ length: 1 + next(4) }, () => next(40));
      const whole = parts.reduce((a, b) => a + b, 0);
      const split = createRater(catalogOf({ svc: [price] }));
      const lines = parts.flatMap((part) => split.rate([charge('tiered', part)]) ?? []);
      const single = createRater(catalogOf({ svc: [price] })).rate([charge('tiered', whole)]);
      expect(total(lines)).toBe(total(single));
      const billed = trim(toFixed(sum(lines.map((line) => line.quantity)), 12));
      expect(billed).toBe(String(Math.max(0, whole - 7)));
    }
  });
});
