import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { DesignDocument, Region } from '../../../shared/lib/design';
import { httpPriceFiles } from '../api/httpPriceFiles';
import { catalogServices } from '../application/catalogServices';
import { createCatalogSession, type LoadCatalog } from '../application/catalogSession';
import { CatalogError, createCatalogLoader } from '../application/loadCatalog';
import type { PriceCatalog, PriceSource } from '../model/catalog';

/** O catálogo muda no máximo uma vez por semana: um dia sem revalidar. */
const STALE_TIME_MS = 24 * 60 * 60 * 1000;
/** Catálogo de outra região ou de outra lista de serviços fica em memória por uma hora. */
const GC_TIME_MS = 60 * 60 * 1000;
/** Tentativas a mais para falha de rede; os outros erros não mudam ao repetir. */
const NETWORK_RETRIES = 2;

const sessionLoad = createCatalogSession(() => createCatalogLoader(httpPriceFiles()));

/** Query key do catálogo: só strings (região e serviços em ordem). `Decimal` nunca entra aqui. */
export const priceCatalogKey = (region: Region, services: readonly string[]) =>
  ['pricing', 'catalog', region, [...services]] as const;

/**
 * Estado do catálogo de preços do design.
 * - `idle`: o design não tem bloco do contrato; nada é buscado.
 * - `ready`: `catalog` vai para o motor; `source` e `generatedAt` (ISO 8601, UTC) vêm do manifest,
 *   para o aviso do editor. Com `updating`, o catálogo ainda é o do design anterior (outra região
 *   ou lista de serviços) e o novo está a caminho.
 * - `error`: `error.kind` diz o que houve; `retry` tenta de novo. Mostre texto próprio por `kind`.
 */
export type PriceCatalogState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly error: CatalogError; readonly retry: () => void }
  | {
      readonly status: 'ready';
      readonly catalog: PriceCatalog;
      readonly source: PriceSource;
      readonly generatedAt: string;
      readonly updating: boolean;
    };

/**
 * Carrega, com TanStack Query, os arquivos de preço da região e dos serviços que o design usa.
 * O `PriceCatalog` (com `Decimal`) fica só no cache em memória da query; não o persista.
 * Erro nunca é lançado na renderização: chega como estado.
 */
export function usePriceCatalog(
  design: Pick<DesignDocument, 'region' | 'blocks'>,
  load: LoadCatalog = sessionLoad,
): PriceCatalogState {
  const { region } = design;
  const services = catalogServices(design);
  const query = useQuery<PriceCatalog, CatalogError>({
    queryKey: priceCatalogKey(region, services),
    queryFn: () =>
      load(region, services).catch((error: unknown) => {
        throw error instanceof CatalogError ? error : new CatalogError('network');
      }),
    enabled: services.length > 0,
    staleTime: STALE_TIME_MS,
    gcTime: GC_TIME_MS,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: (failures, error) => error.kind === 'network' && failures < NETWORK_RETRIES,
    placeholderData: keepPreviousData,
    // O catálogo guarda `Map` e `Decimal` (`bigint`): sem comparação estrutural nem cópia.
    structuralSharing: false,
    throwOnError: false,
  });

  if (services.length === 0) return { status: 'idle' };
  if (query.data) {
    const { source, generatedAt } = query.data.manifest;
    const updating = query.isPlaceholderData;
    return { status: 'ready', catalog: query.data, source, generatedAt, updating };
  }
  if (query.error) {
    return { status: 'error', error: query.error, retry: () => void query.refetch() };
  }
  return { status: 'loading' };
}
