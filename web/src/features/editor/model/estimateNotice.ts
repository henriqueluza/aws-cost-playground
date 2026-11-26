/** Data e origem do catálogo de preços para o aviso de estimativa (PRD F16). */
export type CatalogStamp =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'unavailable' }
  | {
      readonly status: 'ready';
      readonly source: 'seed' | 'price-list';
      /** ISO 8601 em UTC, como no `manifest.json`. */
      readonly generatedAt: string;
    };

/**
 * O que o aviso precisa do estado do catálogo. Tipo estrutural para o model não importar
 * `pricing`: o `PriceCatalogState` de `usePriceCatalog` é atribuível a ele sem cast.
 */
export type CatalogStateLike =
  | { readonly status: 'idle' | 'loading' | 'error' }
  | {
      readonly status: 'ready';
      readonly source: 'seed' | 'price-list';
      readonly generatedAt: string;
    };

/** `idle`: o design não tem bloco, nada foi buscado. `error` vira `unavailable`. */
export function catalogStamp(state: CatalogStateLike): CatalogStamp {
  if (state.status === 'ready') {
    return { status: 'ready', source: state.source, generatedAt: state.generatedAt };
  }
  if (state.status === 'error') return { status: 'unavailable' };
  return { status: state.status };
}

const BASE = 'Estimativa on-demand, não é cotação oficial';
const ISO_DAY = /^\d{4}-\d{2}-\d{2}/;

export function estimateNoticeText(stamp: CatalogStamp): string {
  if (stamp.status === 'idle') return `${BASE} · a data dos preços aparece com o primeiro bloco`;
  if (stamp.status === 'loading') return `${BASE} · carregando a data dos preços`;
  if (stamp.status === 'ready' && ISO_DAY.test(stamp.generatedAt)) {
    const origin = stamp.source === 'seed' ? 'valores de exemplo' : 'AWS Price List';
    return `${BASE} · preços de ${stamp.generatedAt.slice(0, 10)} · ${origin}`;
  }
  return `${BASE} · data dos preços indisponível`;
}
