import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDesignStore } from '../../editor';
import { ApiError, isApiError } from '../../../shared/lib/api';
import { useApi } from '../../../shared/lib/api/ApiProvider';
import { designDocumentSchema, type DesignDocument } from '../../../shared/lib/design';
import { errorKind, saveDesign } from '../application/saveDesign';
import { savedDesignStore } from './savedDesignStore';

/** Só dados serializáveis: nada de `Decimal`, catálogo de preços nem documento na chave. */
export const designsKeys = { list: ['designs', 'list'] as const };

export function useDesignsList() {
  const api = useApi();
  return useQuery({ queryKey: designsKeys.list, queryFn: () => api.designs.list(), retry: false });
}

/** Salvar o design atual. O estado vai para a store, então sobrevive a trocar de tela no meio. */
export function useSaveDesign() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; doc: DesignDocument }) => {
      const store = savedDesignStore.getState();
      if (!store.begin()) return;
      try {
        const saved = await saveDesign(api, { saved: store.saved, ...input });
        savedDesignStore.getState().finish(saved);
        void client.invalidateQueries({ queryKey: designsKeys.list });
      } catch (error) {
        savedDesignStore.getState().fail(errorKind(error));
      }
    },
  });
}

/** Abrir: busca, valida o documento com zod e só então o põe na store. Erro vira `ApiError`. */
export function useOpenDesign() {
  const api = useApi();
  const loadDesign = useDesignStore((s) => s.loadDesign);
  const client = useQueryClient();
  return useMutation({
    // Um design que sumiu: a lista mostrada está velha.
    onError: (error) => {
      if (isApiError(error, 'not-found'))
        void client.invalidateQueries({ queryKey: designsKeys.list });
    },
    mutationFn: async (id: string) => {
      const design = await api.designs.get(id);
      const doc = designDocumentSchema.safeParse(design.doc);
      if (!doc.success || !loadDesign(doc.data).ok) {
        throw new ApiError({ kind: 'invalid-response' });
      }
      savedDesignStore
        .getState()
        .setSaved({ id: design.id, name: design.name, version: design.version, doc: doc.data });
    },
  });
}
