import { describe, expect, it } from 'vitest';
import { decimal } from '../../../shared/lib/money';
import { formatQuantity, formatUnitPrice, formatUsd } from './formatUsd';

describe('formatUsd', () => {
  it.each([
    ['0', 'US$ 0,00'],
    ['84.3', 'US$ 84,30'],
    ['1234.5', 'US$ 1.234,50'],
    ['12345.67', 'US$ 12.345,67'],
    ['9999999.99', 'US$ 9.999.999,99'],
    ['0.01', 'US$ 0,01'],
    ['0.0149', 'US$ 0,01'],
    ['0.015', 'US$ 0,02'],
    ['0.0004', '< US$ 0,01'],
    ['0.009', '< US$ 0,01'],
    ['-3.1', '−US$ 3,10'],
    ['-0.0004', '> \u2212US$ 0,01'],
  ])('%s vira %s', (input, expected) => {
    expect(formatUsd(decimal(input))).toBe(expected);
  });

  it('não perde precisão onde o ponto flutuante perderia', () => {
    expect(formatUsd(decimal('999999999999.99'))).toBe('US$ 999.999.999.999,99');
  });
});

describe('formatUnitPrice', () => {
  it.each([
    ['0.0000002', 'US$ 0,0000002'],
    ['0.0416', 'US$ 0,0416'],
    ['0.04', 'US$ 0,04'],
    ['1', 'US$ 1,00'],
    ['1234.5', 'US$ 1.234,50'],
    ['0.000000000001', 'US$ 0,000000000001'],
  ])('%s vira %s', (input, expected) => {
    expect(formatUnitPrice(decimal(input))).toBe(expected);
  });
});

describe('formatQuantity', () => {
  it.each([
    ['0', '0'],
    ['3000000', '3.000.000'],
    ['2000000', '2.000.000'],
    ['0.5', '0,5'],
    ['730', '730'],
    ['1234.125', '1.234,125'],
    ['100', '100'],
  ])('%s vira %s', (input, expected) => {
    expect(formatQuantity(decimal(input))).toBe(expected);
  });
});
