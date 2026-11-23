import type { ReactElement } from 'react';
import styles from './Notice.module.css';

/** Tom do aviso ("Pílulas de estado" e "Estados" do DESIGN.md). Não há tom de sucesso. */
export type NoticeTone = 'negative' | 'warning' | 'neutral';

export type NoticeProps = {
  /** `negative` é `role="alert"` (anunciado na hora); `warning`, `role="status"`; `neutral`, `role="note"`. */
  tone: NoticeTone;
  /** A frase do aviso, sempre presente: a cor nunca é o único canal. Vira texto, nunca HTML. */
  message: string;
};

type ToneSpec = {
  role: 'alert' | 'status' | 'note';
  /** Nome do ícone para o leitor de tela; `null` deixa o ícone decorativo. */
  iconLabel: string | null;
  shapes: ReactElement;
};

// Lucide redesenhado na grade de 16 (--icon) para o traço sair com 1,5px; forma própria por tom.
const TONES: Record<NoticeTone, ToneSpec> = {
  negative: {
    role: 'alert',
    iconLabel: 'Erro',
    shapes: (
      <>
        <circle cx="8" cy="8" r="6.67" />
        <path d="M8 5.33V8M8 10.67h.01" />
      </>
    ),
  },
  warning: {
    role: 'status',
    iconLabel: 'Atenção',
    shapes: (
      <>
        <path d="m14.49 12-5.33-9.33a1.33 1.33 0 0 0-2.32 0l-5.33 9.33A1.33 1.33 0 0 0 2.67 14h10.66a1.33 1.33 0 0 0 1.16-2" />
        <path d="M8 6v2.67M8 11.33h.01" />
      </>
    ),
  },
  // Informação: o ícone só acompanha a frase, então fica fora da árvore de acessibilidade.
  neutral: {
    role: 'note',
    iconLabel: null,
    shapes: (
      <>
        <circle cx="8" cy="8" r="6.67" />
        <path d="M8 10.67V8M8 5.33h.01" />
      </>
    ),
  },
};

/** Aviso: frase com ícone de forma própria por tom, no par claro e escuro da pílula do mesmo tom. */
export function Notice({ tone, message }: NoticeProps): ReactElement {
  const { role, iconLabel, shapes } = TONES[tone];
  const iconA11y =
    iconLabel === null ? { 'aria-hidden': true } : { role: 'img', 'aria-label': iconLabel };
  return (
    <div role={role} className={`${styles.notice} ${styles[tone]}`}>
      <svg className={styles.icon} viewBox="0 0 16 16" focusable="false" {...iconA11y}>
        {shapes}
      </svg>
      <p className={styles.message}>{message}</p>
    </div>
  );
}
