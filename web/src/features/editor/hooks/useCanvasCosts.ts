import { useMemo } from 'react';
import type { DesignDocument } from '../../../shared/lib/design';
import { decimal, compare } from '../../../shared/lib/money';
import { estimate, usePriceCatalog } from '../../pricing';
import { formatUsd, type CostView } from '../model/canvasModel';

const NONE: ReadonlyMap<string, CostView> = new Map();

/**
 * Custo mensal de cada bloco, já em texto. Sem catálogo ou sem preço, o bloco não entra no mapa
 * e o nó mostra o traço. O `Decimal` não sai daqui.
 */
export function useCanvasCosts(design: DesignDocument): ReadonlyMap<string, CostView> {
  const state = usePriceCatalog(design);
  const catalog = state.status === 'ready' ? state.catalog : null;
  return useMemo(() => {
    if (!catalog) return NONE;
    const costs = new Map<string, CostView>();
    for (const cost of estimate(design, catalog).blocks) {
      if (cost.status === 'priced') {
        costs.set(cost.blockId, {
          text: formatUsd(cost.total),
          zero: compare(cost.total, decimal(0)) === 0,
        });
      }
    }
    return costs;
  }, [design, catalog]);
}
