import { createStore, type StoreApi } from 'zustand/vanilla';
import {
  CLIENT_NODE_ID,
  type DesignDocument,
  type EdgeKind,
  type Region,
  type Usage,
} from '../../../shared/lib/design';
import * as act from '../model/designActions';
import {
  EMPTY_HISTORY,
  NUDGE_WINDOW_MS,
  record,
  redo as redoStep,
  undo as undoStep,
  type Grouping,
  type History,
  type Move,
  type StepKind,
} from '../model/history';
import {
  DEFAULT_EDGE_USAGE,
  EMPTY_STATE,
  type ActionErrorCode,
  type BlockPatch,
  type EditorState,
  type ElementRef,
  type Layout,
  type NewBlock,
  type NewEdge,
  type Position,
  type Result,
  type Selection,
} from '../model/editorState';

export type IdSource = { blockId(): string; edgeId(): string };
export type DesignActions = {
  addBlock(block: NewBlock, position: Position): Result<string>;
  moveBlock(id: string, position: Position): Result<void>;
  removeBlock(id: string): Result<void>;
  editBlock(id: string, patch: BlockPatch): Result<void>;
  connect(edge: NewEdge): Result<string>;
  removeEdge(id: string): Result<void>;
  setEdgeKind(id: string, kind: EdgeKind): Result<void>;
  setUsage(target: ElementRef, usage: Usage): Result<void>;
  setOverride(target: ElementRef, key: string, value: number | null): Result<void>;
  select(selection: Selection): Result<void>;
  setRegion(region: Region): Result<void>;
  /** Descrição da carga; digitação em sequência é um passo só (como as setas do canvas). */
  setDescription(description: string): Result<void>;
  /** Documento com o `usage` novo vindo da estimativa, gravado como UM passo desfazível. */
  applyEstimate(next: DesignDocument): Result<void>;
  loadDesign(raw: unknown): Result<void>;
  replaceDocument(doc: DesignDocument): Result<void>;
  /** Desfaz o último passo; devolve o que foi desfeito, ou `null` se não havia. */
  undo(): StepKind | null;
  redo(): StepKind | null;
  /** Um arrasto é um passo só: os `moveBlock` entre os dois contam juntos. */
  beginGesture(): void;
  endGesture(): void;
};
/** Estado do histórico fica na store, fora de `EditorState` (que é o que se desenha). */
export type DesignStoreState = EditorState & DesignActions & { readonly history: History };
export type DesignStore = StoreApi<DesignStoreState>;

/** Ids aleatórios no formato do schema. */
export const randomIds: IdSource = {
  blockId: () => `blk_${crypto.randomUUID()}`,
  edgeId: () => `edg_${crypto.randomUUID()}`,
};

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = (code: ActionErrorCode): Result<never> => ({ ok: false, error: { code } });
const finite = (p: Position): boolean => Number.isFinite(p.x) && Number.isFinite(p.y);
const exists = (doc: DesignDocument, ref: Selection): boolean =>
  ref === null || (ref.kind === 'block' ? doc.blocks : doc.edges).some((e) => e.id === ref.id);
const keepSelection = (doc: DesignDocument, sel: Selection): Selection =>
  exists(doc, sel) ? sel : null;
/** Só as posições de bloco do documento (ou `client`) com x e y finitos. */
const pickLayout = (doc: DesignDocument, layout: Layout): Layout =>
  Object.fromEntries(
    Object.entries(layout).filter(
      ([id, p]) => (id === CLIENT_NODE_ID || doc.blocks.some((b) => b.id === id)) && finite(p),
    ),
  );

/** `initial` é confiado (só código do app e testes o passam); o que vem de fora entra por `loadDesign`. */
export function createDesignStore(
  initial: EditorState = EMPTY_STATE,
  ids: IdSource = randomIds,
  clock: () => number = Date.now,
): DesignStore {
  return createStore<DesignStoreState>()((set, get) => {
    let gesture: number | null = null;
    let gestures = 0;
    const samePosition = (id: string, p: Position): boolean => {
      const at = get().layout[id];
      return at !== undefined && at.x === p.x && at.y === p.y;
    };
    /** Grava o documento (e o que `extra` pedir) só se a ação pura aceitou; cada uma é um passo. */
    const apply = <T>(
      r: Result<DesignDocument>,
      value: T,
      kind: StepKind,
      extra: (s: EditorState, doc: DesignDocument) => Partial<EditorState> = () => ({}),
      group?: Grouping,
    ): Result<T> => {
      if (!r.ok) return r;
      set((s) => ({
        document: r.value,
        ...extra(s, r.value),
        history: record(s.history, s, kind, group),
      }));
      return ok(value);
    };
    /** Passo de arrasto (um por gesto) ou de setas (um por sequência no mesmo bloco). */
    const grouping = (id: string): Grouping =>
      gesture === null
        ? { key: `nudge:${id}`, now: clock(), windowMs: NUDGE_WINDOW_MS }
        : { key: `drag:${gesture}`, now: 0, windowMs: Infinity };
    const goto = (move: Move | null): StepKind | null => {
      if (!move) return null;
      set((s) => ({
        document: move.snapshot.document,
        layout: move.snapshot.layout,
        selection: keepSelection(move.snapshot.document, s.selection),
        history: move.history,
      }));
      return move.kind;
    };
    const prune = (s: EditorState, doc: DesignDocument): Partial<EditorState> => ({
      layout: pickLayout(doc, s.layout),
      selection: keepSelection(doc, s.selection),
    });
    const doc = (): DesignDocument => get().document;
    return {
      ...initial,
      history: EMPTY_HISTORY,
      addBlock: (block, position) => {
        if (!finite(position)) return fail('invalid-position');
        const id = ids.blockId();
        return apply(
          act.addBlock(doc(), { ...block, id, overrides: {} }),
          id,
          'add-block',
          (s) => ({
            layout: { ...s.layout, [id]: position },
          }),
        );
      },
      moveBlock: (id, position) => {
        if (id !== CLIENT_NODE_ID && !doc().blocks.some((b) => b.id === id))
          return fail('unknown-block');
        if (!finite(position)) return fail('invalid-position');
        if (samePosition(id, position)) return ok(undefined);
        set((s) => ({
          layout: { ...s.layout, [id]: position },
          history: record(s.history, s, 'move-block', grouping(id)),
        }));
        return ok(undefined);
      },
      removeBlock: (id) => apply(act.removeBlock(doc(), id), undefined, 'remove-block', prune),
      editBlock: (id, patch) => apply(act.editBlock(doc(), id, patch), undefined, 'edit-block'),
      connect: (edge) => {
        const id = ids.edgeId();
        const full = { ...edge, usage: edge.usage ?? DEFAULT_EDGE_USAGE, id, overrides: {} };
        return apply(act.connect(doc(), full), id, 'connect');
      },
      removeEdge: (id) => apply(act.removeEdge(doc(), id), undefined, 'remove-edge', prune),
      setEdgeKind: (id, kind) =>
        apply(act.setEdgeKind(doc(), id, kind), undefined, 'set-edge-kind'),
      setUsage: (target, usage) =>
        apply(act.setUsage(doc(), target, usage), undefined, 'set-usage'),
      setOverride: (target, key, value) =>
        apply(act.setOverride(doc(), target, key, value), undefined, 'set-override'),
      select: (selection) => {
        if (selection !== null && !exists(doc(), selection)) {
          return fail(selection.kind === 'block' ? 'unknown-block' : 'unknown-edge');
        }
        set({ selection });
        return ok(undefined);
      },
      setRegion: (region) => apply(act.setRegion(doc(), region), undefined, 'set-region'),
      setDescription: (text) => {
        const r = act.setDescription(doc(), text);
        if (r.ok && text === doc().workload.description) return ok(undefined);
        const group = { key: 'description', now: clock(), windowMs: NUDGE_WINDOW_MS };
        return apply(r, undefined, 'set-description', () => ({}), group);
      },
      applyEstimate: (next) => apply(act.parseDesign(next), undefined, 'apply-estimate', prune),
      loadDesign: (raw) =>
        apply(act.parseDesign(raw), undefined, 'replace-design', () => ({
          selection: null,
          layout: {},
        })),
      replaceDocument: (next) => apply(act.parseDesign(next), undefined, 'replace-design', prune),
      undo: () => goto(undoStep(get().history, get())),
      redo: () => goto(redoStep(get().history, get())),
      beginGesture: () => {
        gesture = ++gestures;
      },
      endGesture: () => {
        gesture = null;
      },
    };
  });
}

/** Store única do editor no app. */
export const designStore: DesignStore = createDesignStore();
