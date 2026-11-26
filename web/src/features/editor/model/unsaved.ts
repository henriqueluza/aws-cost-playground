import type { DesignDocument } from '../../../shared/lib/design';

/** Igualdade estrutural de JSON: a ordem das chaves não conta, a ordem das listas conta. */
function sameJson(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, i) => sameJson(item, b[i]))
    );
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && sameJson(a[key as never], b[key as never]))
  );
}

/**
 * Há alteração não salva quando o documento em edição difere do último carregado ou salvo.
 * Posição de bloco e seleção não entram: não fazem parte do documento.
 */
export function hasUnsavedChanges(current: DesignDocument, saved: DesignDocument): boolean {
  return !sameJson(current, saved);
}
