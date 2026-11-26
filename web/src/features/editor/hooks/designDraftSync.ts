import { useEffect } from 'react';
import type { DesignDocument } from '../../../shared/lib/design';
import { saveDesignDraft, takeDesignDraft } from '../model/designDraft';
import { referenceDesign } from '../model/template/referenceTemplate';
import { hasUnsavedChanges } from '../model/unsaved';
import { designStore } from './designStore';

/** O template inicial intocado conta como vazio: não há nele trabalho a guardar nem a perder. */
const hasContent = (doc: DesignDocument) =>
  (doc.blocks.length > 0 || doc.edges.length > 0 || doc.workload.description !== '') &&
  hasUnsavedChanges(doc, referenceDesign());

/**
 * Antes de sair para o login: guarda o design em edição, se há o que guardar. Um design vazio não
 * é guardado (voltaria por cima do estado inicial sem motivo).
 */
export function keepDesignForLogin(): void {
  const { document } = designStore.getState();
  if (hasContent(document)) saveDesignDraft(document);
}

/**
 * Na volta do login, devolve ao editor o design guardado, uma vez só. Só entra num editor vazio
 * (a página recarregou na ida): o que a pessoa já tem na tela nunca é trocado por um rascunho.
 */
export function useRestoreDesignDraft(): void {
  useEffect(() => {
    const draft = takeDesignDraft();
    if (draft !== null && !hasContent(designStore.getState().document)) {
      designStore.getState().loadDesign(draft);
    }
  }, []);
}
