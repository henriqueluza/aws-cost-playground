import { DESIGN_LIMITS } from '../../../shared/lib/design';
import type { LabelError } from '../model/blockForm';

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
