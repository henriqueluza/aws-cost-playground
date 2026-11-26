import { blockDefinition, formatUsd } from '../../pricing';
import { compare, decimal, sub, type Decimal } from '../../../shared/lib/money';
import { directionOf, type Direction } from '../model/compare';

const ZERO = decimal(0);
const ONE_CENT = decimal('0.01');

/** A palavra que acompanha o sinal: a diferença nunca depende só da cor. */
export const DIRECTION_WORD: Record<Direction, string> = {
  more: 'a mais',
  less: 'a menos',
  same: 'igual',
};

/** Diferença com sinal no texto (DESIGN.md): `+US$ 12,40`, `−US$ 3,10`; zero é `US$ 0,00`. */
export function formatDiff(diff: Decimal): string {
  const direction = directionOf(diff);
  if (direction === 'same') return formatUsd(ZERO);
  const size = direction === 'more' ? diff : sub(ZERO, diff);
  const sign = direction === 'more' ? '+' : '−';
  if (compare(size, ONE_CENT) < 0) return `${direction === 'more' ? '<' : '>'} ${sign}US$ 0,01`;
  return `${sign}${formatUsd(size)}`;
}

const EDGE_LABELS: Record<string, string> = {
  data: 'Transferência de dados',
  'runs-on': 'Executa em',
  logs: 'Envio de logs',
};

/** Nome do tipo no contrato; tipo desconhecido vira o próprio texto. */
export const blockTypeLabel = (type: string): string => blockDefinition(type)?.name ?? type;
export const edgeKindLabel = (kind: string): string => EDGE_LABELS[kind] ?? kind;
export const plural = (n: number, one: string, many: string): string =>
  `${n} ${n === 1 ? one : many}`;
