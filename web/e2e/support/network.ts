import type { Page } from '@playwright/test';

/**
 * Registra toda requisição do contexto (página, workers, abas novas) cuja origem não é a do site.
 * A URL da API e a do Cognito vêm do `/config.json` e ficam em outra origem; no build servido pelo
 * `vite preview` o cliente HTTP é o de produção, então uma chamada à API aparece aqui.
 */
export function watchForeignRequests(page: Page, siteUrl: string): string[] {
  const siteOrigin = new URL(siteUrl).origin;
  const foreign: string[] = [];
  page.context().on('request', (request) => {
    if (new URL(request.url()).origin !== siteOrigin) {
      foreign.push(`${request.method()} ${request.url()}`);
    }
  });
  return foreign;
}
