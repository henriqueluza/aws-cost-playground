import { DESIGN_LIMITS } from '../../../shared/lib/design';
import type { LabelError, UsageField, UsageInputError } from '../model/blockForm';
import { formatRangeNumber, unitLabel } from './blockLabels';

const REASONS: Record<UsageInputError, string> = {
  empty: 'Digite um valor.',
  format: 'Use só algarismos, com vírgula para os decimais.',
  thousands: 'Digite sem separador de milhar.',
  fraction: 'Use um número inteiro.',
  range: 'Valor fora da faixa.',
};

/** Frase de erro de um campo de uso: o motivo e sempre a faixa permitida com a unidade. */
export function usageErrorMessage(error: UsageInputError, field: UsageField): string {
  const unit = unitLabel(field.unit) ?? field.unit;
  const range = `${formatRangeNumber(field.min)} a ${formatRangeNumber(field.max)} ${unit}`;
  return `${REASONS[error]} Faixa permitida: ${range}${field.integer ? ', número inteiro' : ''}.`;
}

/** Frase de erro do rótulo do bloco. */
export function labelErrorMessage(error: LabelError, length: number): string {
  return error === 'control'
    ? 'O nome não pode ter caracteres de controle nem quebra de linha.'
    : `Use até ${DESIGN_LIMITS.maxLabelLength} caracteres (tem ${length}).`;
}

export const ORIGIN_TEXT = {
  manual: 'alterado à mão',
  llm: 'estimado pela LLM',
  default: 'padrão',
} as const;
