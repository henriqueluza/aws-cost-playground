import { useMemo, useState } from 'react';
import type { DesignDocument } from '../../../shared/lib/design';
import { buildCostRows, type CostRows } from '../application/costRows';
import type { CatalogErrorKind } from '../application/loadCatalog';
import { estimate, type CostEstimate } from '../model/engine';
import type { PriceCatalogState } from './usePriceCatalog';

interface Settled {
  readonly estimate: CostEstimate;
  readonly rows: CostRows;
}

/** O que o painel mostra: o estado do catálogo mais, quando pronto, o resultado do motor. */
export type CostView =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly kind: CatalogErrorKind; readonly retry: () => void }
  | (Settled & { readonly status: 'ready'; readonly updating: boolean });

/**
 * Liga o motor (síncrono e puro) ao estado do catálogo. O resultado é memoizado pela identidade
 * do design e do catálogo, então só muda quando um deles muda (a store cria um documento novo a
 * cada edição). Com `updating`, o catálogo ainda é o do design anterior: o painel mantém o último
 * resultado fechado em vez de mostrar itens "sem preço" que só faltam por o catálogo não ter chegado.
 */
export function useCostView(design: DesignDocument, state: PriceCatalogState): CostView {
  const catalog = state.status === 'ready' ? state.catalog : null;
  const updating = state.status === 'ready' && state.updating;
  const fresh = useMemo<Settled | null>(() => {
    if (catalog === null || updating) return null;
    const result = estimate(design, catalog);
    return { estimate: result, rows: buildCostRows(design, result) };
  }, [design, catalog, updating]);

  // Estado derivado na renderização (padrão da documentação do React): guarda o último resultado.
  const [held, setHeld] = useState<Settled | null>(null);
  if (fresh !== null && fresh !== held) setHeld(fresh);

  if (state.status === 'idle' || state.status === 'loading') return { status: state.status };
  if (state.status === 'error') {
    return { status: 'error', kind: state.error.kind, retry: state.retry };
  }
  const shown = fresh ?? held;
  return shown === null ? { status: 'loading' } : { status: 'ready', ...shown, updating };
}
