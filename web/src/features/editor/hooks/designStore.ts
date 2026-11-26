import { createStore, type StoreApi } from 'zustand/vanilla';
import {
  CLIENT_NODE_ID,
  type DesignDocument,
  type Region,
  type Usage,
} from '../../../shared/lib/design';
import * as act from '../model/designActions';
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
import { referenceDesign, referenceLayout } from '../model/template/referenceTemplate';

export type IdSource = { blockId(): string; edgeId(): string };
export type DesignActions = {
  addBlock(block: NewBlock, position: Position): Result<string>;
  moveBlock(id: string, position: Position): Result<void>;
  removeBlock(id: string): Result<void>;
  editBlock(id: string, patch: BlockPatch): Result<void>;
  connect(edge: NewEdge): Result<string>;
  removeEdge(id: string): Result<void>;
  setUsage(target: ElementRef, usage: Usage): Result<void>;
  setOverride(target: ElementRef, key: string, value: number | null): Result<void>;
  select(selection: Selection): Result<void>;
  setRegion(region: Region): Result<void>;
  loadDesign(raw: unknown): Result<void>;
  replaceDocument(doc: DesignDocument): Result<void>;
  /** Troca o design inteiro pelo template inicial (PRD F5); o confirmar antes é de quem chama. */
  newDesign(): void;
  /** Marca o documento atual como salvo (baixado): zera o aviso de alteração pendente. */
  markSaved(): void;
};
/** `baseline`: o último documento carregado ou salvo (`markSaved`, depois de baixar); a comparação com ele diz se há alteração pendente. */
export type DesignStoreState = EditorState & DesignActions & { readonly baseline: DesignDocument };
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
): DesignStore {
  return createStore<DesignStoreState>()((set, get) => {
    /** Grava o documento (e o que `extra` pedir) só se a ação pura aceitou. */
    const apply = <T>(
      r: Result<DesignDocument>,
      value: T,
      extra: (s: EditorState, doc: DesignDocument) => Partial<EditorState> = () => ({}),
    ): Result<T> => {
      if (!r.ok) return r;
      set((s) => ({ document: r.value, ...extra(s, r.value) }));
      return ok(value);
    };
    const prune = (s: EditorState, doc: DesignDocument): Partial<EditorState> => ({
      layout: pickLayout(doc, s.layout),
      selection: keepSelection(doc, s.selection),
    });
    const doc = (): DesignDocument => get().document;
    return {
      ...initial,
      baseline: initial.document,
      addBlock: (block, position) => {
        if (!finite(position)) return fail('invalid-position');
        const id = ids.blockId();
        return apply(act.addBlock(doc(), { ...block, id, overrides: {} }), id, (s) => ({
          layout: { ...s.layout, [id]: position },
        }));
      },
      moveBlock: (id, position) => {
        if (id !== CLIENT_NODE_ID && !doc().blocks.some((b) => b.id === id))
          return fail('unknown-block');
        if (!finite(position)) return fail('invalid-position');
        set((s) => ({ layout: { ...s.layout, [id]: position } }));
        return ok(undefined);
      },
      removeBlock: (id) => apply(act.removeBlock(doc(), id), undefined, prune),
      editBlock: (id, patch) => apply(act.editBlock(doc(), id, patch), undefined),
      connect: (edge) => {
        const id = ids.edgeId();
        const full = { ...edge, usage: edge.usage ?? DEFAULT_EDGE_USAGE, id, overrides: {} };
        return apply(act.connect(doc(), full), id);
      },
      removeEdge: (id) => apply(act.removeEdge(doc(), id), undefined, prune),
      setUsage: (target, usage) => apply(act.setUsage(doc(), target, usage), undefined),
      setOverride: (target, key, value) =>
        apply(act.setOverride(doc(), target, key, value), undefined),
      select: (selection) => {
        if (selection !== null && !exists(doc(), selection)) {
          return fail(selection.kind === 'block' ? 'unknown-block' : 'unknown-edge');
        }
        set({ selection });
        return ok(undefined);
      },
      setRegion: (region) => apply(act.setRegion(doc(), region), undefined),
      loadDesign: (raw) =>
        apply(act.parseDesign(raw), undefined, (_, loaded) => ({
          selection: null,
          layout: {},
          baseline: loaded,
        })),
      replaceDocument: (next) =>
        apply(act.parseDesign(next), undefined, (s, replaced) => ({
          ...prune(s, replaced),
          baseline: replaced,
        })),
      markSaved: () => set({ baseline: get().document }),
      newDesign: () => {
        const template = referenceDesign();
        set({ document: template, baseline: template, layout: referenceLayout(), selection: null });
      },
    };
  });
}

/** Store única do editor no app. Sem design aberto, ela começa no template inicial. */
export const designStore: DesignStore = createDesignStore({
  document: referenceDesign(),
  layout: referenceLayout(),
  selection: null,
});
