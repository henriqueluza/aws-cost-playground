import type { ReactElement } from 'react';

/** Tom do aviso ("Pílulas de estado" e "Estados" do DESIGN.md). Não há tom de sucesso. */
export type NoticeTone = 'negative' | 'warning' | 'neutral';

export type NoticeProps = {
  /** `negative` é `role="alert"` (anunciado na hora); `warning`, `role="status"`; `neutral`, `role="note"`. */
  tone: NoticeTone;
  /** A frase do aviso, sempre presente: a cor nunca é o único canal. Vira texto, nunca HTML. */
  message: string;
};

/** Aviso: frase com ícone de forma própria por tom, no par claro e escuro da pílula do mesmo tom. */
export function Notice(props: NoticeProps): ReactElement {
  throw new Error(`Notice: contrato sem implementação (${props.tone})`);
}
