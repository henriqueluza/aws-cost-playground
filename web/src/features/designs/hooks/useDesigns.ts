import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../../../shared/lib/api/ApiProvider';
import type { DesignDocument } from '../../../shared/lib/design';
import { errorKind, saveDesign } from '../application/saveDesign';
import { savedDesignStore } from './savedDesignStore';

/** Só dados serializáveis: nada de `Decimal`, catálogo de preços nem documento na chave. */
export const designsKeys = { list: ['designs', 'list'] as const };

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
