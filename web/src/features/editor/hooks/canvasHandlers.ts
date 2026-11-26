import type { DesignActions } from './designStore';
import type { Selection } from '../model/editorState';

/** Subconjunto das mudanças do React Flow que o canvas traduz; o resto (dimensões) é ignorado. */
export type FlowChange =
  | { type: 'position'; id: string; position?: { x: number; y: number } }
  | { type: 'select'; id: string; selected: boolean }
  | { type: 'remove'; id: string }
  | { type: 'dimensions' | 'add' | 'replace'; id?: string };

type Actions = Pick<DesignActions, 'moveBlock' | 'removeBlock' | 'removeEdge' | 'select'>;

/** Traduz `onNodesChange` em ações da store. O `client` nunca é removido. */
export function applyNodeChanges(
  changes: readonly FlowChange[],
  actions: Actions,
  selection: Selection,
  clientId: string,
): void {
  for (const change of changes) {
    if (change.type === 'position' && change.position) {
      actions.moveBlock(change.id, change.position);
    } else if (change.type === 'remove' && change.id !== clientId) {
      actions.removeBlock(change.id);
    }
  }
  applySelection(changes, 'block', actions, selection);
}

/** Traduz `onEdgesChange` em ações da store. */
export function applyEdgeChanges(
  changes: readonly FlowChange[],
  actions: Actions,
  selection: Selection,
): void {
  for (const change of changes) {
    if (change.type === 'remove') actions.removeEdge(change.id);
  }
  applySelection(changes, 'edge', actions, selection);
}

/** A seleção é única: o último `select` ligado vence; desligar o selecionado limpa a seleção. */
function applySelection(
  changes: readonly FlowChange[],
  kind: 'block' | 'edge',
  actions: Actions,
  selection: Selection,
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
  if (dropped) actions.select(null);
}
