/**
 * Dinheiro e quantidades sem ponto flutuante binário: decimal de ponto fixo, um `bigint`
 * escalado em 10^-12 USD. `Decimal` nunca entra em JSON, em query key nem em estado
 * persistido; sai por `toFixed`.
 */
declare const decimalBrand: unique symbol;
export type Decimal = bigint & { readonly [decimalBrand]: true };
export type Money = Decimal;

export const DECIMAL_PLACES = 12;

const UNIT = 10n ** BigInt(DECIMAL_PLACES);
const NUMERIC = /^([+-]?)(\d+)(?:\.(\d+))?(?:e([+-]?\d{1,3}))?$/i;
// Entrada não confiável: limita o trabalho do BigInt (1e21 passa; 1e999 não).
const MAX_INPUT_LENGTH = 64;
const MAX_EXPONENT = 40;

const brand = (value: bigint): Decimal => value as Decimal;

/** Divide arredondando meio-para-par. */
function divideHalfEven(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder === 0n) return quotient;
  const twice = 2n * (remainder < 0n ? -remainder : remainder);
  const size = denominator < 0n ? -denominator : denominator;
  const roundsAway = twice > size || (twice === size && quotient % 2n !== 0n);
  if (!roundsAway) return quotient;
  return numerator < 0n === denominator < 0n ? quotient + 1n : quotient - 1n;
}

/**
 * Constrói um `Decimal`. Aceita a notação exponencial de `Number#toString` (`1e-7`, `1e21`).
 * Além de 12 casas arredonda meio-para-par; quem precisa recusar valida antes.
 */
export function decimal(value: string | number): Decimal {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new RangeError('Decimal: número não finito');
  }
  const text = String(value);
  const match = text.length <= MAX_INPUT_LENGTH ? NUMERIC.exec(text) : null;
  if (!match) throw new RangeError('Decimal: formato inválido');
  const [, sign, integer = '', fraction = '', exponentText = '0'] = match;
  const exponent = Number(exponentText);
  if (Math.abs(exponent) > MAX_EXPONENT) throw new RangeError('Decimal: expoente fora da faixa');

  const digits = BigInt(integer + fraction) * (sign === '-' ? -1n : 1n);
  const shift = DECIMAL_PLACES + exponent - fraction.length;
  return brand(
    shift >= 0 ? digits * 10n ** BigInt(shift) : divideHalfEven(digits, 10n ** BigInt(-shift)),
  );
}

export const add = (a: Decimal, b: Decimal): Decimal => brand(a + b);

export const sub = (a: Decimal, b: Decimal): Decimal => brand(a - b);

export const mul = (a: Decimal, b: Decimal): Decimal => brand(divideHalfEven(a * b, UNIT));

export function div(a: Decimal, b: Decimal): Decimal {
  if (b === 0n) throw new RangeError('Decimal: divisão por zero');
  return brand(divideHalfEven(a * UNIT, b));
}

export function compare(a: Decimal, b: Decimal): -1 | 0 | 1 {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export function sum(values: Iterable<Decimal>): Decimal {
  let total = 0n;
  for (const value of values) total += value;
  return brand(total);
}

/** Texto decimal com `fractionDigits` casas (0 a 12), arredondado meio-para-par. */
export function toFixed(value: Decimal, fractionDigits: number): string {
  if (!Number.isInteger(fractionDigits) || fractionDigits < 0 || fractionDigits > DECIMAL_PLACES) {
    throw new RangeError('Decimal: casas decimais fora de 0 a 12');
  }
  const scaled = divideHalfEven(value, 10n ** BigInt(DECIMAL_PLACES - fractionDigits));
  const digits = (scaled < 0n ? -scaled : scaled).toString().padStart(fractionDigits + 1, '0');
  const integer = digits.slice(0, digits.length - fractionDigits);
  const fraction = fractionDigits === 0 ? '' : `.${digits.slice(-fractionDigits)}`;
  return `${scaled < 0n ? '-' : ''}${integer}${fraction}`;
}
