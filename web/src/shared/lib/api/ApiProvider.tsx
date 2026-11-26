import { createContext, useContext, type ReactNode } from 'react';
import type { Api } from './ports';

/**
 * Entrega as portas da API às telas. É o único módulo de `shared/lib/api` com React (fica fora do
 * bloco de pureza do lint) e não é reexportado pelo `index.ts`, que continua só contrato.
 * Quem escolhe a implementação (HTTP ou fake) é o `app/bootstrap.tsx`.
 */
const ApiContext = createContext<Api | null>(null);

export function ApiProvider({ api, children }: { api: Api; children: ReactNode }) {
  return <ApiContext value={api}>{children}</ApiContext>;
}

/** As portas da API. Lança se não houver `ApiProvider` acima: é erro de programação. */
export function useApi(): Api {
  const api = useContext(ApiContext);
  if (!api) throw new Error('useApi precisa de um <ApiProvider> acima na árvore de componentes.');
  return api;
}
