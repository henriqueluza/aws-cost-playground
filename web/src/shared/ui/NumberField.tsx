import { useId } from 'react';
import { Field, fieldBoxClass, useFieldControl } from './Field';
import type { FieldBaseProps } from './Field';
import styles from './Field.module.css';
import type { NativeInputProps } from './TextField';

export type NumberFieldProps = Omit<NativeInputProps, 'inputMode'> &
  FieldBaseProps & {
    /** Unidade dentro do campo, à direita (ex.: `GB/mês`); entra na descrição acessível. */
    unit?: string;
    /** `decimal` (padrão) traz a vírgula no teclado do celular; `numeric`, só algarismos. */
    inputMode?: 'decimal' | 'numeric';
  };

/** Campo numérico: texto com `inputMode`, algarismos tabulares e a unidade dentro da caixa. */
export function NumberField({ label, error, density, unit, inputMode, ...rest }: NumberFieldProps) {
  const unitId = useId();
  const { errorId, ...aria } = useFieldControl(error, unit ? [unitId] : []);
  const box = fieldBoxClass({ error, density, disabled: rest.disabled }, styles.affix);
  return (
    <Field controlId={aria.id} errorId={errorId} label={label} error={error}>
      <div className={box}>
        <input
          autoComplete="off"
          {...rest}
          {...aria}
          type="text"
          inputMode={inputMode ?? 'decimal'}
          className={styles.bare}
        />
        {unit ? (
          <span id={unitId} className={styles.unit}>
            {unit}
          </span>
        ) : null}
      </div>
    </Field>
  );
}
