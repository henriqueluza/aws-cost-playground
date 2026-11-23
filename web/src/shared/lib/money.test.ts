import { describe, expect, it } from 'vitest';

import { add, compare, decimal, div, mul, sub, sum, toFixed } from './money';

const show = (value: ReturnType<typeof decimal>) => toFixed(value, 12);

describe('decimal', () => {
  it.each([
    ['0.6', '0.600000000000'],
    ['-12.5', '-12.500000000000'],
    ['+3', '3.000000000000'],
    ['0.000000000001', '0.000000000001'],
    [0.0000002, '0.000000200000'],
    [1e-7, '0.000000100000'],
    [1e21, '1000000000000000000000.000000000000'],
    ['2.5E3', '2500.000000000000'],
    [-0, '0.000000000000'],
  ])('lê %s como %s', (input, expected) => {
    expect(show(decimal(input))).toBe(expected);
  });

  it('arredonda meio-para-par além de 12 casas', () => {
    expect(show(decimal('0.0000000000005'))).toBe('0.000000000000');
    expect(show(decimal('0.0000000000015'))).toBe('0.000000000002');
    expect(show(decimal('-0.0000000000025'))).toBe('-0.000000000002');
    expect(show(decimal(0.1 + 0.2))).toBe('0.300000000000');
  });

  it.each([
    NaN,
    Infinity,
    -Infinity,
    '',
    ' 1',
    '1.',
    '.5',
    '1,5',
    '0x10',
    '1e',
    'abc',
    '1e41',
    '1e-41',
    '1e9999',
    '1'.repeat(65),
  ])('recusa %s com RangeError', (input) => {
    expect(() => decimal(input)).toThrow(RangeError);
  });
});

describe('exatidão (critério de aceite da #8)', () => {
  it('3000000 × 0.0000002 = 0.6', () => {
    expect(show(mul(decimal(3_000_000), decimal(0.0000002)))).toBe('0.600000000000');
  });

  it('180000 × 0.0000166667 = 3.000006', () => {
    expect(show(mul(decimal(180_000), decimal('0.0000166667')))).toBe('3.000006000000');
  });

  it('soma 1e6 parcelas de 0.1 sem erro acumulado', () => {
    const parcel = decimal('0.1');
    const parcels = Array.from({ length: 1_000_000 }, () => parcel);
    expect(show(sum(parcels))).toBe('100000.000000000000');
    expect(parcels.reduce((total) => total + 0.1, 0)).not.toBe(100_000);
  });
});

describe('operações', () => {
  it('soma e subtrai sem perder casas', () => {
    expect(show(add(decimal('0.1'), decimal('0.2')))).toBe('0.300000000000');
    expect(show(sub(decimal('1'), decimal('0.9')))).toBe('0.100000000000');
    expect(show(sum([]))).toBe('0.000000000000');
  });

  it('mul arredonda meio-para-par na 12ª casa', () => {
    const half = decimal('0.5');
    expect(show(mul(decimal('0.000000000001'), half))).toBe('0.000000000000');
    expect(show(mul(decimal('0.000000000003'), half))).toBe('0.000000000002');
    expect(show(mul(decimal('-0.000000000003'), half))).toBe('-0.000000000002');
  });

  it('div arredonda meio-para-par e respeita o sinal', () => {
    expect(show(div(decimal(1), decimal(3)))).toBe('0.333333333333');
    expect(show(div(decimal(2), decimal(3)))).toBe('0.666666666667');
    expect(show(div(decimal(-2), decimal(3)))).toBe('-0.666666666667');
    expect(show(div(decimal(2), decimal(-3)))).toBe('-0.666666666667');
    expect(show(div(decimal('0.000000000001'), decimal(2)))).toBe('0.000000000000');
    expect(show(div(decimal('0.000000000003'), decimal(2)))).toBe('0.000000000002');
  });

  it('div por zero lança RangeError', () => {
    expect(() => div(decimal(1), decimal(0))).toThrow(RangeError);
  });

  it('compare ordena', () => {
    expect(compare(decimal('0.1'), decimal('0.2'))).toBe(-1);
    expect(compare(decimal('0.2'), decimal('0.1'))).toBe(1);
    expect(compare(decimal('1.0'), decimal(1))).toBe(0);
  });
});

describe('toFixed', () => {
  it.each([
    ['1234.5', 2, '1234.50'],
    ['0.125', 2, '0.12'],
    ['0.135', 2, '0.14'],
    ['-0.125', 2, '-0.12'],
    ['-0.001', 2, '0.00'],
    ['2.5', 0, '2'],
    ['3.5', 0, '4'],
    ['0.05', 4, '0.0500'],
  ])('%s com %i casas é %s', (input, digits, expected) => {
    expect(toFixed(decimal(input), digits)).toBe(expected);
  });

  it.each([-1, 13, 1.5, NaN])('recusa %s casas', (digits) => {
    expect(() => toFixed(decimal(1), digits)).toThrow(RangeError);
  });
});
