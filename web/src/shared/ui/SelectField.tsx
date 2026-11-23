import type { ComponentPropsWithRef, ReactNode } from 'react';
import type { FieldBaseProps } from './Field';

type NativeSelectProps = Omit<
  ComponentPropsWithRef<'select'>,
  'className' | 'style' | 'id' | 'size' | 'multiple' | 'aria-invalid' | 'aria-describedby'
>;

export type SelectFieldProps = NativeSelectProps &
  FieldBaseProps & {
    /** As opções, como `<option>` (e `<optgroup>`) filhos React. */
    children: ReactNode;
  };

/** Seleção com `<select>` nativo e seta própria, decorativa. */
export function SelectField(props: SelectFieldProps): ReactNode {
  void props;
  throw new Error('contrato: implementar');
}
