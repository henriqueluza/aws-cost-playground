import type { ComponentPropsWithRef } from 'react';
import { Field, fieldBoxClass, useFieldControl, type FieldBaseProps } from './Field';
import styles from './Field.module.css';

type NativeAreaProps = Omit<
  ComponentPropsWithRef<'textarea'>,
  'className' | 'style' | 'id' | 'children' | 'aria-invalid'
>;

export type TextAreaFieldProps = NativeAreaProps &
  FieldBaseProps & {
    /** Ids extras (contador, dica) lidos junto do rótulo, antes do erro. */
    describedBy?: readonly string[];
  };

/** Campo de texto de várias linhas, com o rótulo e o erro do mesmo molde do `TextField`. */
export function TextAreaField({ label, error, density, describedBy, ...rest }: TextAreaFieldProps) {
  const { errorId, ...aria } = useFieldControl(error, describedBy ?? []);
  return (
    <Field controlId={aria.id} errorId={errorId} label={label} error={error}>
      <textarea
        {...rest}
        {...aria}
        className={fieldBoxClass({ error, density, disabled: rest.disabled }, styles.area)}
      />
    </Field>
  );
}
