/** Data e origem do catálogo de preços para o aviso de estimativa (PRD F16). */
export type CatalogStamp =
  | { readonly status: 'loading' }
  | { readonly status: 'unavailable' }
  | {
      readonly status: 'ready';
      readonly source: 'seed' | 'price-list';
      /** ISO 8601 em UTC, como no `manifest.json`. */
      readonly generatedAt: string;
    };

const BASE = 'Estimativa on-demand, não é cotação oficial';
const ISO_DAY = /^\d{4}-\d{2}-\d{2}/;

export function estimateNoticeText(stamp: CatalogStamp): string {
  if (stamp.status === 'loading') return `${BASE} · carregando a data dos preços`;
  if (stamp.status === 'ready' && ISO_DAY.test(stamp.generatedAt)) {
    const origin = stamp.source === 'seed' ? 'valores de exemplo' : 'AWS Price List';
    return `${BASE} · preços de ${stamp.generatedAt.slice(0, 10)} · ${origin}`;
  }
  return `${BASE} · data dos preços indisponível`;
}
