import { isApiError, type Api, type ApiErrorKind } from '../../../shared/lib/api';
import type { DesignDocument } from '../../../shared/lib/design';
import type { SavedDesign } from '../model/saveState';

/**
 * Cria o design (sem `saved`) ou atualiza o salvo, com a versão lida. A identidade do usuário
 * não é enviada: vem do JWT, no servidor. Em `version-conflict` nada é sobrescrito.
 */
export async function saveDesign(
  api: Api,
  input: { saved: SavedDesign | null; name: string; doc: DesignDocument },
): Promise<SavedDesign> {
  const { saved, name, doc } = input;
  const result =
    saved === null
      ? await api.designs.create({ name, doc })
      : await api.designs.update(saved.id, { expectedVersion: saved.version, doc });
  return { id: result.id, name: result.name, version: result.version, doc };
}

/** Qualquer falha vira um código conhecido: o que não é `ApiError` conta como indisponível. */
export function errorKind(error: unknown): ApiErrorKind {
  return isApiError(error) ? error.kind : 'unavailable';
}
