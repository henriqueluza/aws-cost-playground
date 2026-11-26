import { compare, decimal, DECIMAL_PLACES, toFixed, type Decimal } from '../../../shared/lib/money';

/**
 * Formatação de dólar do painel de custo (DESIGN.md, "Números e unidades"), a partir de `toFixed`:
 * nada passa por `number` nem por `Intl`, então não há erro de ponto flutuante.
 *
 * - Valor do resumo (total, linha, cobrança): sempre 2 casas, `US$ 1.234,56`. Valor positivo que
 *   arredondaria para zero (menos de um centavo) sai como `< US$ 0,01`, nunca como `US$ 0,00`.
 *   Zero real é `US$ 0,00`.
 * - Preço unitário (`formatUnitPrice`): exato, de 2 a 12 casas, sem zeros à direita além das 2
 *   primeiras (`US$ 0,0000002`), porque é o número que o usuário confere contra a tabela da AWS.
 * - Sinal negativo: U+2212.
 */
const MINUS = '−';
const ONE_CENT = decimal('0.01');
const ZERO = decimal(0);

function groupThousands(integer: string): string {
  return integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** Separa sinal, parte inteira (com milhar) e fração de um texto de `toFixed`. */
function localize(fixed: string): { sign: string; body: string } {
  const sign = fixed.startsWith('-') ? MINUS : '';
  const [integer = '0', fraction] = fixed.replace('-', '').split('.');
  const body =
    fraction === undefined ? groupThousands(integer) : `${groupThousands(integer)},${fraction}`;
  return { sign, body };
}

const abs = (value: Decimal): Decimal => (compare(value, ZERO) < 0 ? (-value as Decimal) : value);

export function formatUsd(value: Decimal): string {
  if (compare(value, ZERO) !== 0 && compare(abs(value), ONE_CENT) < 0) {
    return `< US$ 0,01`;
  }
  const { sign, body } = localize(toFixed(value, 2));
  return `${sign}US$ ${body}`;
}

/** Preço de uma unidade, exato: de 2 a 12 casas, sem zeros à direita além das 2 primeiras. */
export function formatUnitPrice(value: Decimal): string {
  const exact = toFixed(value, DECIMAL_PLACES);
  const trimmed = exact.replace(/(\.\d{2}\d*?)0+$/, '$1');
  const { sign, body } = localize(trimmed);
  return `${sign}US$ ${body}`;
}

/** Quantidade cobrada: separador de milhar e até 12 casas, sem zeros à direita (`3.000.000`). */
export function formatQuantity(value: Decimal): string {
  const exact = toFixed(value, DECIMAL_PLACES);
  const { sign, body } = localize(exact.includes('.') ? exact.replace(/\.?0+$/, '') : exact);
  return `${sign}${body}`;
}
