import type { Api } from './ports';

/**
 * Fake em memória de `DesignsApi` e `AccountApi`, para testes e para o modo de desenvolvimento.
 * Não é reexportado por `index.ts`, para não entrar no bundle de produção.
 */
export type InMemoryApiOptions = {
  maxDesigns: number;
  /** Bytes UTF-8 de `JSON.stringify(doc)`; acima disso, `too-large`. */
  maxDocBytes: number;
  /** Padrão `() => new Date()`. */
  now?: () => Date;
  /** Padrão: contador a partir de 1 com `padStart(26, '0')`, que passa em `designIdSchema`. */
  newId?: () => string;
};

export function createInMemoryApi(options: InMemoryApiOptions): Pick<Api, 'designs' | 'account'> {
  void options;
  throw new Error('Não implementado.');
}
