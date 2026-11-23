import { useId } from 'react';
import type { ReactNode } from 'react';
import styles from './Field.module.css';

/** Altura: `panel` (padrão) usa `--control-height`; `form`, `--control-height-form` (diálogos). */
export type FieldDensity = 'panel' | 'form';

/** Props comuns ao campo de texto, ao numérico e à seleção. */
export type FieldBaseProps = {
  /** Rótulo sempre visível acima e nome acessível; o placeholder nunca o substitui. */
  label: string;
  /** Uma frase que diz o que fazer. Presente, liga `aria-invalid` e `aria-describedby`. */
  error?: string;
  density?: FieldDensity;
};

/** Ids do controle e do erro, e o `aria-describedby` com os ids extras (a unidade) antes do erro. */
export function useFieldControl(error: string | undefined, extra: readonly string[] = []) {
  const id = useId();
  const errorId = `${id}-erro`;
  const describedBy = error ? [...extra, errorId] : extra;
  return {
    id,
    errorId,
    'aria-invalid': error ? (true as const) : undefined,
    'aria-describedby': describedBy.length > 0 ? describedBy.join(' ') : undefined,
  };
}

type BoxState = Pick<FieldBaseProps, 'error' | 'density'> & { disabled?: boolean | undefined };

/** Classes da caixa com a borda: o input, o select ou a caixa da unidade. */
export function fieldBoxClass({ error, density, disabled }: BoxState, extra?: string): string {
  const names = [styles.control, extra, density === 'form' && styles.form];
  return [...names, error && styles.invalid, disabled && styles.disabled].filter(Boolean).join(' ');
}

// Lucide circle-alert em 14 × 14 (--icon-inline); decorativo, a frase é o que se lê.
const errorIcon = (
  <svg className={styles.errorIcon} viewBox="0 0 14 14" aria-hidden="true" focusable="false">
    <circle cx="7" cy="7" r="5.83" />
    <path d="M7 4.67V7M7 9.33h.01" />
  </svg>
);

type FieldProps = {
  controlId: string;
  errorId: string;
  label: string;
  error?: string;
  children: ReactNode;
};

/** Estrutura comum: rótulo acima, o controle e, se houver, o erro com ícone decorativo. */
export function Field({ controlId, errorId, label, error, children }: FieldProps) {
  return (
    <div className={styles.field}>
      <label htmlFor={controlId} className={styles.label}>
        {label}
      </label>
      {children}
      {error ? (
        <p id={errorId} className={styles.error}>
          {errorIcon}
          {error}
        </p>
      ) : null}
    </div>
  );
}
