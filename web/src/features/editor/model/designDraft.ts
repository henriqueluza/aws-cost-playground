import type { DesignDocument } from '../../../shared/lib/design';
import { parseDesignFile, serializeDesign } from './designFile';

const KEY = 'aws-cost-playground:design-draft';
/** O rascunho vale pelo tempo de uma ida ao login e volta. */
export const DRAFT_TTL_MS = 30 * 60_000;

const area = (storage?: Storage): Storage | null => {
  try {
    return storage ?? globalThis.sessionStorage;
  } catch {
    return null;
  }
};

/**
 * Guarda o design em edição na aba (`sessionStorage`) antes de sair para o login, para ele voltar
 * junto. Só o documento (o mesmo JSON do arquivo baixado: nenhum token, nenhum dado de conta).
 * Devolve `false` se não guardou (armazenamento bloqueado ou design grande demais).
 */
export function saveDesignDraft(
  doc: DesignDocument,
  now: () => number = Date.now,
  storage?: Storage,
): boolean {
  const where = area(storage);
  const text = serializeDesign(doc);
  if (!where || text === null) return false;
  try {
    where.setItem(KEY, JSON.stringify({ savedAt: now(), text }));
    return true;
  } catch {
    return false;
  }
}

/**
 * De uso único: devolve o rascunho e o apaga. Vencido, ilegível ou fora do schema do design vira
 * `null` (o arquivo passa pela mesma validação de "Abrir arquivo").
 */
export function takeDesignDraft(
  now: () => number = Date.now,
  storage?: Storage,
): DesignDocument | null {
  const where = area(storage);
  if (!where) return null;
  let raw: string | null;
  try {
    raw = where.getItem(KEY);
    where.removeItem(KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    const saved = JSON.parse(raw) as { savedAt?: unknown; text?: unknown };
    const fresh = typeof saved.savedAt === 'number' && now() - saved.savedAt <= DRAFT_TTL_MS;
    if (!fresh || typeof saved.text !== 'string') return null;
    const result = parseDesignFile(saved.text);
    return result.ok ? result.document : null;
  } catch {
    return null;
  }
}
