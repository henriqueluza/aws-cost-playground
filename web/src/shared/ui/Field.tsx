import type { ReactNode } from 'react';

/**
 * Altura do controle (DESIGN.md, "Campos"): `panel` usa `--control-height` (painéis e barras);
 * `form` usa `--control-height-form` (diálogos e páginas de texto).
 */
export type FieldDensity = 'panel' | 'form';

/** Props comuns ao campo de texto, ao numérico e à seleção. */
export type FieldBaseProps = {
  /** Rótulo sempre visível acima do campo e nome acessível. O placeholder nunca o substitui. */
  label: string;
  /** Uma frase que diz o que fazer. Presente, liga `aria-invalid` e `aria-describedby`. */
  error?: string;
  /** Padrão `panel`. */
  density?: FieldDensity;
};

/** Atributos que o controle recebe para se ligar ao rótulo, à unidade e ao erro. */
export type FieldControlAria = {
  id: string;
  'aria-invalid': true | undefined;
  'aria-describedby': string | undefined;
};

/**
 * Gera o id do controle e o do erro (`useId`) e monta `aria-describedby` com os ids extras
 * (ex.: a unidade) seguidos do id do erro, só quando há erro.
 */
export function useFieldControl(
  error: string | undefined,
  extraDescribedBy: readonly string[] = [],
): FieldControlAria & { errorId: string } {
  void error;
  void extraDescribedBy;
  throw new Error('contrato: implementar');
}

export type FieldProps = {
  /** Id do controle, para o `<label htmlFor>`. */
  controlId: string;
  /** Id da mensagem de erro, referenciado pelo `aria-describedby` do controle. */
  errorId: string;
  label: string;
  error?: string;
  /** O controle (input, select ou a caixa com a unidade). */
  children: ReactNode;
};

/** Estrutura comum: rótulo acima, o controle e, se houver, a mensagem de erro com ícone. */
export function Field(props: FieldProps): ReactNode {
  void props;
  throw new Error('contrato: implementar');
}
