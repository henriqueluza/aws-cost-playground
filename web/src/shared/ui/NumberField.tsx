import type { ReactNode } from 'react';
import type { FieldBaseProps } from './Field';
import type { NativeInputProps } from './TextField';

export type NumberFieldProps = Omit<NativeInputProps, 'inputMode'> &
  FieldBaseProps & {
    /** Unidade dentro do campo, à direita, em `--faint` (ex.: `GB/mês`). Entra na descrição acessível. */
    unit?: string;
    /** `decimal` (padrão) traz a vírgula no teclado do celular; `numeric` só algarismos (contagens). */
    inputMode?: 'decimal' | 'numeric';
  };

/**
 * Campo numérico: `<input type="text">` com `inputMode`, algarismos tabulares e a unidade dentro
 * da caixa. O valor é texto; a validação de cada regra fica com a feature.
 */
export function NumberField(props: NumberFieldProps): ReactNode {
  void props;
  throw new Error('contrato: implementar');
}
