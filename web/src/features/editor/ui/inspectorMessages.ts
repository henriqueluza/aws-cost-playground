import { DESIGN_LIMITS } from '../../../shared/lib/design';
import type { LabelError } from '../model/blockForm';

/** Frase de erro do rótulo do bloco; fixa, para o leitor de tela não repeti-la a cada tecla. */
export function labelErrorMessage(error: LabelError): string {
  return error === 'control'
    ? 'O nome não pode ter caracteres de controle nem quebra de linha.'
    : `Use até ${DESIGN_LIMITS.maxLabelLength} caracteres.`;
}

export const ORIGIN_TEXT = {
  manual: 'alterado à mão',
  llm: 'estimado pela LLM',
  default: 'padrão',
} as const;
