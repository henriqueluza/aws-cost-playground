import type { ComponentPropsWithRef, ReactNode } from 'react';
import type { FieldBaseProps } from './Field';

/** Atributos nativos do `<input>` que o chamador pode passar; o resto o campo controla. */
export type NativeInputProps = Omit<
  ComponentPropsWithRef<'input'>,
  'className' | 'style' | 'type' | 'id' | 'size' | 'children' | 'aria-invalid' | 'aria-describedby'
>;

export type TextFieldProps = NativeInputProps & FieldBaseProps;

/** Campo de texto de uma linha (`<input type="text">`). */
export function TextField(props: TextFieldProps): ReactNode {
  void props;
  throw new Error('contrato: implementar');
}
