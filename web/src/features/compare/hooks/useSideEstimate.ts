import { useMemo } from 'react';
import type { DesignDocument } from '../../../shared/lib/design';
import {
  estimate,
  usePriceCatalog,
  type CatalogErrorKind,
  type CostEstimate,
  type PriceCatalog,
  type PriceCatalogState,
} from '../../pricing';

/** O que um lado da comparação mostra: o estado do catálogo da região do design e a estimativa. */
export type SideState =
  | { readonly status: 'empty' }
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly kind: CatalogErrorKind; readonly retry: () => void }
  | { readonly status: 'ready'; readonly estimate: CostEstimate; readonly generatedAt: string };

const NO_DESIGN: DesignDocument = {
  schemaVersion: 1,
  region: 'us-east-1',
  workload: { description: '' },
  blocks: [],
  edges: [],
  scenarios: [],
};

/** Design sem nada que tenha preço no catálogo (vazio, ou só blocos de custo zero): catálogo vazio. */
function emptyCatalog(region: DesignDocument['region']): PriceCatalog {
  return {
    region,
    manifest: { schemaVersion: 1, source: 'seed', generatedAt: '', files: [] },
    services: new Map(),
  };
}

/**
 * Estimativa de UM lado, com o catálogo da região do próprio design (cada lado tem o seu). Só lê:
 * nunca toca a store do editor nem faz chamada à API. Com `updating`, o catálogo ainda é o do
 * documento anterior; o lado fica "carregando" em vez de mostrar itens sem preço que só faltam
 * porque o catálogo não chegou.
 */
export function useSideEstimate(document: DesignDocument | null): SideState {
  const design = document ?? NO_DESIGN;
  const state: PriceCatalogState = usePriceCatalog(design);
  const catalog = state.status === 'ready' && !state.updating ? state.catalog : null;
  const generatedAt = state.status === 'ready' ? state.generatedAt : '';
  const settled = useMemo(() => {
    if (document === null) return null;
    if (state.status === 'idle') return estimate(document, emptyCatalog(document.region));
    return catalog === null ? null : estimate(document, catalog);
  }, [document, state.status, catalog]);

  if (document === null) return { status: 'empty' };
  if (state.status === 'error') {
    return { status: 'error', kind: state.error.kind, retry: state.retry };
  }
  return settled === null
    ? { status: 'loading' }
    : { status: 'ready', estimate: settled, generatedAt };
}
