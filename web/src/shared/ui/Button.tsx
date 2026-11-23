import type { ComponentPropsWithRef, ReactNode } from 'react';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'destructive';

type NativeProps = Omit<ComponentPropsWithRef<'button'>, 'className' | 'style' | 'type'>;

export type ButtonProps = NativeProps & {
  /** Um primário por tela. Destrutivo só com confirmação que nomeia o objeto (DESIGN.md). */
  variant?: ButtonVariant;
  type?: 'button' | 'submit';
};

/** Botão de texto. O texto vem sempre como filho React, nunca como HTML. */
export function Button({ variant = 'secondary', type = 'button', ...rest }: ButtonProps) {
  return <button {...rest} type={type} className={`${styles.button} ${styles[variant]}`} />;
}

export type IconButtonProps = NativeProps & {
  /** Obrigatório: o botão não tem texto visível. Também é o tooltip. */
  'aria-label': string;
  /** O ícone (SVG de 16px); decorativo, o nome vem do `aria-label`. */
  children: ReactNode;
  variant?: Exclude<ButtonVariant, 'tertiary'>;
  type?: 'button' | 'submit';
};

/** Botão de ícone de 32 × 32, com `aria-label` e tooltip. */
export function IconButton({
  variant = 'secondary',
  type = 'button',
  children,
  ...rest
}: IconButtonProps) {
  return (
    <button
      title={rest['aria-label']}
      {...rest}
      type={type}
      className={`${styles.button} ${styles[variant]} ${styles.icon}`}
    >
      <span className={styles.glyph} aria-hidden="true">
        {children}
      </span>
    </button>
  );
}
