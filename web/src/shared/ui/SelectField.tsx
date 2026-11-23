import type { ComponentPropsWithRef, ReactNode } from 'react';
import { Field, fieldBoxClass, useFieldControl, type FieldBaseProps } from './Field';
import styles from './Field.module.css';

type NativeSelectProps = Omit<
  ComponentPropsWithRef<'select'>,
  'className' | 'style' | 'id' | 'size' | 'multiple' | 'aria-invalid' | 'aria-describedby'
>;

/** As opções vêm como filhos `<option>` (e `<optgroup>`). */
export type SelectFieldProps = NativeSelectProps & FieldBaseProps & { children: ReactNode };

/** Seleção com `<select>` nativo e seta própria, decorativa. */
export function SelectField({ label, error, density, children, ...rest }: SelectFieldProps) {
  const { errorId, ...aria } = useFieldControl(error);
  const box = fieldBoxClass({ error, density, disabled: rest.disabled }, styles.select);
  return (
    <Field controlId={aria.id} errorId={errorId} label={label} error={error}>
      <div className={styles.selectWrap}>
        <select {...rest} {...aria} className={box}>
          {children}
        </select>
        {/* Lucide chevron-down em 16 × 16 (--icon); a seta nativa sai com `appearance: none` */}
        <svg className={styles.chevron} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path d="m4 6 4 4 4-4" />
        </svg>
      </div>
    </Field>
  );
}
