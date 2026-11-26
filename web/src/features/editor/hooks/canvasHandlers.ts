import type { DesignDocument } from '../../../shared/lib/design';
import { checkConnection } from '../model/canvasModel';
import type { DesignActions, DesignStoreState } from './designStore';
import type { Selection } from '../model/editorState';

/** Subconjunto das mudanças do React Flow que o canvas traduz; o resto (dimensões) é ignorado. */
export type FlowChange =
  | { type: 'position'; id: string; position?: { x: number; y: number } }
  | { type: 'select'; id: string; selected: boolean }
  | { type: 'remove'; id: string }
  | { type: 'dimensions' | 'add' | 'replace'; id?: string };

type Actions = Pick<DesignActions, 'moveBlock' | 'removeBlock' | 'removeEdge' | 'select'>;
/** Anuncia uma frase fixa em pt-BR (região `aria-live` do editor). */
export type Say = (message: string) => void;
const silent: Say = () => undefined;
/** Ação recusada (`ok: false`) não conta; mock sem resultado conta como aceita. */
const accepted = (r: { ok: boolean } | undefined): boolean => r === undefined || r.ok;

/** Traduz `onNodesChange` em ações da store. O `client` nunca é removido. */
export function applyNodeChanges(
  changes: readonly FlowChange[],
  actions: Actions,
  selection: Selection,
  clientId: string,
  say: Say = silent,
): void {
  let removed = false;
  for (const change of changes) {
    if (change.type === 'position' && change.position) {
      actions.moveBlock(change.id, change.position);
    } else if (change.type === 'remove' && change.id !== clientId) {
      removed = accepted(actions.removeBlock(change.id)) || removed;
    }
  }
  applySelection(changes, 'block', actions, selection, say);
  if (removed) say('Bloco removido'); // por último: vale mais que "Seleção removida"
}

/** Traduz `onEdgesChange` em ações da store. */
export function applyEdgeChanges(
  changes: readonly FlowChange[],
  actions: Actions,
  selection: Selection,
  say: Say = silent,
): void {
  let removed = false;
  for (const change of changes) {
    if (change.type === 'remove') removed = accepted(actions.removeEdge(change.id)) || removed;
  }
  applySelection(changes, 'edge', actions, selection, say);
  if (removed) say('Conexão removida');
}

/** A seleção é única: o último `select` ligado vence; desligar o selecionado limpa a seleção. */
function applySelection(
  changes: readonly FlowChange[],
  kind: 'block' | 'edge',
  actions: Actions,
  selection: Selection,
  say: Say,
): void {
  const picks = changes.filter((c) => c.type === 'select');
  const chosen = picks.findLast((c) => c.selected);
  if (chosen) {
    if (selection?.kind !== kind || selection.id !== chosen.id) {
      actions.select({ kind, id: chosen.id });
    }
    return;
  }
  const dropped = picks.some((c) => selection?.kind === kind && c.id === selection.id);
  if (dropped) {
    actions.select(null);
    say('Seleção removida');
  }
}

type ConnectionEnds = { readonly source: string; readonly target: string };

/**
 * `onConnect`: valida pelo contrato e chama `connect`. Devolve a frase da recusa, ou `null` se a
 * aresta foi criada.
 */
export function connectBlocks(
  ends: ConnectionEnds,
  store: Pick<DesignStoreState, 'document' | 'connect'>,
): string | null {
  const check = checkConnection(store.document, ends.source, ends.target);
  if (!check.ok) return check.message;
  const result = store.connect({ source: ends.source, target: ends.target, kind: check.kind });
  return result.ok ? null : 'Não foi possível criar a conexão.';
}

/** `onConnectEnd`: o motivo de uma conexão que o React Flow recusou em silêncio. */
export function refusalMessage(document: DesignDocument, ends: ConnectionEnds): string | null {
  const check = checkConnection(document, ends.source, ends.target);
  return check.ok ? null : check.message;
}
