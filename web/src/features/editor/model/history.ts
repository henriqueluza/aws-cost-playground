import type { DesignDocument } from '../../../shared/lib/design';
import type { Layout } from './editorState';

/**
 * Histórico de desfazer, função pura sobre estados imutáveis. Guarda só o que o usuário desenha:
 * o documento e as posições. Seleção, zoom e estado de tela ficam de fora.
 */
export type Snapshot = { readonly document: DesignDocument; readonly layout: Layout };

/** Ação que gerou o passo; o texto que a descreve vem de `stepText`. */
export type StepKind =
  | 'add-block'
  | 'move-block'
  | 'remove-block'
  | 'edit-block'
  | 'connect'
  | 'remove-edge'
  | 'set-usage'
  | 'set-override'
  | 'set-region'
  | 'replace-design';

const STEP_TEXT: Record<StepKind, string> = {
  'add-block': 'adicionar bloco',
  'move-block': 'mover bloco',
  'remove-block': 'remover bloco',
  'edit-block': 'editar bloco',
  connect: 'conectar blocos',
  'remove-edge': 'remover conexão',
  'set-usage': 'mudar uso',
  'set-override': 'mudar valor',
  'set-region': 'mudar região',
  'replace-design': 'substituir design',
};
export const stepText = (kind: StepKind): string => STEP_TEXT[kind];

/**
 * Teto de passos desfazíveis (passado e futuro somados nunca passam dele). O schema aceita até
 * 350 KB por documento e a validação devolve cópia, sem compartilhar estrutura: no pior caso
 * (documento no limite, cada passo uma cópia de ~1 MB na memória) são ~100 MB; um design comum
 * (dezenas de blocos, ~30 KB) fica em poucos MB. O mais antigo cai primeiro.
 */
export const HISTORY_LIMIT = 100;
/** Setas em sequência no mesmo bloco, com pausa menor que isto, são um passo só. */
export const NUDGE_WINDOW_MS = 1000;

/** Passo: o estado ANTES da ação (ao refazer, DEPOIS dela), o que ela foi e como agrupar. */
export type Step = Snapshot & {
  readonly kind: StepKind;
  readonly group: string | null;
  readonly until: number;
};
export type History = { readonly past: readonly Step[]; readonly future: readonly Step[] };
export const EMPTY_HISTORY: History = { past: [], future: [] };

export type Grouping = { readonly key: string; readonly now: number; readonly windowMs: number };

/**
 * Registra uma ação que acabou de ser aplicada; `before` é o estado de antes. Com `grouping`, uma
 * ação do mesmo grupo dentro da janela só estende o passo anterior. Ação nova apaga o futuro.
 */
export function record(
  history: History,
  before: Snapshot,
  kind: StepKind,
  grouping?: Grouping,
): History {
  const top = history.past.at(-1);
  if (grouping && top?.group === grouping.key && grouping.now <= top.until) {
    const extended = { ...top, until: grouping.now + grouping.windowMs };
    return { past: [...history.past.slice(0, -1), extended], future: [] };
  }
  const step: Step = {
    document: before.document,
    layout: before.layout,
    kind,
    group: grouping?.key ?? null,
    until: grouping ? grouping.now + grouping.windowMs : 0,
  };
  return { past: [...history.past, step].slice(-HISTORY_LIMIT), future: [] };
}

export type Move = {
  readonly history: History;
  readonly snapshot: Snapshot;
  readonly kind: StepKind;
};

const closed = (s: Snapshot, step: Step): Step => ({
  document: s.document,
  layout: s.layout,
  kind: step.kind,
  group: null, // depois de desfazer, uma nova seta já é outro passo
  until: 0,
});

/** Volta ao estado de antes do último passo; `null` se não há o que desfazer. */
export function undo(history: History, current: Snapshot): Move | null {
  const step = history.past.at(-1);
  if (!step) return null;
  return {
    history: {
      past: history.past.slice(0, -1),
      future: [...history.future, closed(current, step)],
    },
    snapshot: { document: step.document, layout: step.layout },
    kind: step.kind,
  };
}

/** Reaplica o último passo desfeito; `null` se não há o que refazer. */
export function redo(history: History, current: Snapshot): Move | null {
  const step = history.future.at(-1);
  if (!step) return null;
  return {
    history: {
      past: [...history.past, closed(current, step)],
      future: history.future.slice(0, -1),
    },
    snapshot: { document: step.document, layout: step.layout },
    kind: step.kind,
  };
}
