import type { Api, EstimateRequest, EstimateResponse } from './ports';

/**
 * Opções do fake. Os limites não têm padrão: quem chama (teste ou `app/bootstrap.tsx`) passa os
 * valores do ADR (20/300 estimativas por dia, 50 designs, `doc` até 350 KB).
 */
export type InMemoryApiOptions = {
  userDailyLimit: number;
  globalDailyLimit: number;
  maxDesigns: number;
  /** Bytes UTF-8 de `JSON.stringify(doc)`; acima disso, `too-large`. */
  maxDocBytes: number;
  /** Padrão `true`. Com `false`, `estimateUsage` responde `unavailable` sem consumir quota. */
  llmEnabled?: boolean;
  /** Padrão `() => new Date()`. A janela da quota é o dia UTC de `now()`. */
  now?: () => Date;
  /** Padrão: contador decimal com 26 dígitos, que passa em `designIdSchema` e ordena. */
  newId?: () => string;
  /** Padrão: `{ id, values: {} }` para cada bloco e aresta do pedido. */
  estimate?: (request: EstimateRequest) => Pick<EstimateResponse, 'blocks' | 'edges'>;
};

/**
 * Implementação em memória das quatro portas, para testes e para o modo de desenvolvimento.
 * O estado é compartilhado: estimar consome a quota e `deleteAccount` apaga designs e quota do
 * usuário. Todo erro é uma rejeição com `ApiError`; nada lança de forma síncrona.
 * Não é reexportado por `index.ts`, para não entrar no bundle de produção.
 */
export function createInMemoryApi(options: InMemoryApiOptions): Api {
  void options;
  throw new Error('Não implementado.');
}
