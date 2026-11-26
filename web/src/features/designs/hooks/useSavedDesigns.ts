import { useQuery } from '@tanstack/react-query';
import { ApiError, type ApiErrorKind, type DesignSummary } from '../../../shared/lib/api';
import { useApi } from '../../../shared/lib/api/ApiProvider';
import { designDocumentSchema, type DesignDocument } from '../../../shared/lib/design';
import { errorKind } from '../application/saveDesign';
import { designsKeys, useDesignsList } from './useDesigns';

/** Estado de uma leitura só de consulta (sem tocar no editor): o erro já vem como código. */
export type SavedRead<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly kind: ApiErrorKind; readonly retry: () => void }
  | { readonly status: 'ready'; readonly data: T };

/** Os designs da conta, só para escolher (comparação). Quem chama decide se há sessão. */
export function useSavedDesigns(): SavedRead<DesignSummary[]> {
  const list = useDesignsList();
  if (list.isPending) return { status: 'loading' };
  if (list.isError) {
    return { status: 'error', kind: errorKind(list.error), retry: () => void list.refetch() };
  }
  return { status: 'ready', data: list.data };
}

/**
 * Um design salvo, só para ler. O documento do servidor é dado não confiável: passa por
 * `designDocumentSchema` antes de qualquer cálculo; se não passar, é `invalid-response`.
 * Com `id` nulo não há chamada.
 */
export function useSavedDesign(
  id: string | null,
): SavedRead<{ name: string; document: DesignDocument }> | { readonly status: 'idle' } {
  const api = useApi();
  const query = useQuery({
    queryKey: designsKeys.doc(id),
    enabled: id !== null,
    retry: false,
    queryFn: async () => {
      const design = await api.designs.get(id ?? '');
      const parsed = designDocumentSchema.safeParse(design.doc);
      if (!parsed.success) throw new ApiError({ kind: 'invalid-response' });
      return { name: design.name, document: parsed.data };
    },
  });
  if (id === null) return { status: 'idle' };
  if (query.isPending) return { status: 'loading' };
  if (query.isError) {
    return { status: 'error', kind: errorKind(query.error), retry: () => void query.refetch() };
  }
  return { status: 'ready', data: query.data };
}
