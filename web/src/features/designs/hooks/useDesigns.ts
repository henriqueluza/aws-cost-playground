import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { designStore, useDesignStore } from '../../editor';
import { ApiError, isApiError } from '../../../shared/lib/api';
import { useApi } from '../../../shared/lib/api/ApiProvider';
import { designDocumentSchema, type DesignDocument } from '../../../shared/lib/design';
import { errorKind, saveDesign } from '../application/saveDesign';
import { savedDesignStore } from './savedDesignStore';

/** Só dados serializáveis: nada de `Decimal`, catálogo de preços nem documento na chave. */
export const designsKeys = {
  list: ['designs', 'list'] as const,
  doc: (id: string | null) => ['designs', 'doc', id] as const,
};

export function useDesignsList() {
  const api = useApi();
  return useQuery({ queryKey: designsKeys.list, queryFn: () => api.designs.list(), retry: false });
}

/** Salvar o design atual. O estado vai para a store, então sobrevive a trocar de tela no meio. */
export function useSaveDesign() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; doc: DesignDocument; asCopy?: boolean }) => {
      const store = savedDesignStore.getState();
      if (!store.begin()) return;
      try {
        // "Salvar como cópia" (após conflito) cria um design novo, nunca grava sobre o salvo.
        const saved = await saveDesign(api, {
          saved: input.asCopy ? null : store.saved,
          name: input.name,
          doc: input.doc,
        });
        // O documento ENVIADO é o salvo: o que a pessoa editou durante a chamada continua pendente.
        if (savedDesignStore.getState().finish(saved, store.epoch)) {
          designStore.getState().markSaved(input.doc);
        }
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

const invalidateList = (client: ReturnType<typeof useQueryClient>) =>
  client.invalidateQueries({ queryKey: designsKeys.list });

/** Renomear a partir da lista: `update` só com `name`, com a versão lida. */
export function useRenameDesign() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; version: number; name: string }) => {
      const design = await api.designs.update(input.id, {
        expectedVersion: input.version,
        name: input.name,
      });
      const open = savedDesignStore.getState().saved;
      // O design aberto no editor muda só de nome e versão; o documento fica como está.
      if (open?.id === design.id) {
        savedDesignStore.setState({
          saved: { ...open, name: design.name, version: design.version },
        });
      }
    },
    onSettled: () => void invalidateList(client),
  });
}

export function useDuplicateDesign() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; name: string }) => {
      await api.designs.duplicate(input.id, { name: input.name });
    },
    onSettled: () => void invalidateList(client),
  });
}

/** Apagar é idempotente. Se o design apagado está aberto, o vínculo é solto: salvar cria outro. */
export function useDeleteDesign() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.designs.remove(id);
      if (savedDesignStore.getState().saved?.id === id) savedDesignStore.getState().unlink();
    },
    onSettled: () => void invalidateList(client),
  });
}
