import type { DesignDocument } from '../../../shared/lib/design';

/** O que o servidor guardou do design aberto: id, versão e o documento enviado ou recebido. */
export type SavedDesign = {
  readonly id: string;
  readonly name: string;
  readonly version: number;
  readonly doc: DesignDocument;
};

export type SaveStatus = 'unsaved' | 'dirty' | 'saving' | 'saved';

/** Texto de cada estado (pílula e anúncio ao leitor de tela). */
export const SAVE_STATUS_LABEL: Record<SaveStatus, string> = {
  unsaved: 'Não salvo',
  dirty: 'Alterações não salvas',
  saving: 'Salvando…',
  saved: 'Salvo',
};

/** Igualdade profunda de JSON, sem depender da ordem das chaves. */
export function sameDocument(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  const rb = b as Record<string, unknown>;
  return ka.every(
    (k) => Object.hasOwn(rb, k) && sameDocument((a as Record<string, unknown>)[k], rb[k]),
  );
}

/**
 * Estado do salvamento, derivado do documento atual e do último salvo:
 * salvando > nunca salvo > igual ao salvo (salvo) > diferente (alterações não salvas).
 */
export function saveStatus(
  current: DesignDocument,
  saved: SavedDesign | null,
  saving: boolean,
): SaveStatus {
  if (saving) return 'saving';
  if (saved === null) return 'unsaved';
  return sameDocument(current, saved.doc) ? 'saved' : 'dirty';
}
