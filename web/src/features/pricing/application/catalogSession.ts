import type { Region } from '../../../shared/lib/design';
import type { PriceCatalog } from '../model/catalog';
import { CatalogError, type CatalogLoader } from './loadCatalog';

/** Carrega os serviços pedidos numa região; toda falha é um `CatalogError`. */
export type LoadCatalog = (region: Region, services: readonly string[]) => Promise<PriceCatalog>;

/**
 * Um carregador por aplicação: o manifest é lido uma vez. Se um arquivo não bate com o manifest
 * guardado (`integrity`), o catálogo pode ter sido publicado de novo com a aba aberta: troca o
 * carregador, o que relê o manifest, e tenta uma única vez. Uma segunda falha sai como está.
 */
export function createCatalogSession(newLoader: () => CatalogLoader): LoadCatalog {
  let loader = newLoader();
  return async (region, services) => {
    const used = loader;
    try {
      return await used.load(region, services);
    } catch (error) {
      if (!(error instanceof CatalogError) || error.kind !== 'integrity') throw error;
      if (loader === used) loader = newLoader();
      return loader.load(region, services);
    }
  };
}
