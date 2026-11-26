import type { ReactElement, ReactNode } from 'react';

export type DialogProps = {
  /** Aberto ou fechado. Quem controla é a feature; fechado, nada é renderizado. */
  open: boolean;
  /** Pedido de fechar (Esc). A feature decide e muda `open`. */
  onClose: () => void;
  /** Título (h2) e nome acessível do diálogo. Texto da interface, nunca HTML. */
  title: string;
  /** Conteúdo e ações. Ao abrir, o foco vai para o primeiro controle (sem `autoFocus` nos
   *  filhos); por isso "Cancelar" vem antes do primário. Deve ter ao menos um controle que feche. */
  children: ReactNode;
};

/** Diálogo modal: prende o foco, fecha com Esc e devolve o foco a quem o abriu. */
export function Dialog(props: DialogProps): ReactElement | null {
  void props;
  throw new Error('Dialog: não implementado (contrato da #97).');
}
