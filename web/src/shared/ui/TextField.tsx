import type { ComponentPropsWithRef } from 'react';
import { Field, fieldBoxClass, useFieldControl, type FieldBaseProps } from './Field';

/** Atributos nativos do `<input>` que o chamador pode passar; o resto o campo controla. */
export type NativeInputProps = Omit<
  ComponentPropsWithRef<'input'>,
  'className' | 'style' | 'type' | 'id' | 'size' | 'children' | 'aria-invalid' | 'aria-describedby'
>;

export type TextFieldProps = NativeInputProps & FieldBaseProps;

/** Campo de texto de uma linha (`<input type="text">`). */
export function TextField({ label, error, density, ...rest }: TextFieldProps) {
  const { errorId, ...aria } = useFieldControl(error);
  return (
    <Field controlId={aria.id} errorId={errorId} label={label} error={error}>
      <input
        {...rest}
        {...aria}
        type="text"
        className={fieldBoxClass({ error, density, disabled: rest.disabled })}
      />
    </Field>
  );
}
