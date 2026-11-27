import type { Page } from '@playwright/test';

/**
 * `/config.json` dos testes de ponta a ponta. O build servido pelo `vite preview` é o de produção
 * e recusa `http://` na configuração, então o `public/config.json` de desenvolvimento não serve:
 * cada teste recebe uma configuração `https` fictícia, e nada dela é chamado sem `page.route`. O
 * login gerenciado segue a regra de produção, `auth.` + o host do site (`auth.localhost`).
 */
export const API = 'https://api.e2e.test';
export const CLIENT_ID = 'e2e-client';

export const loginOrigin = (siteUrl: string) => `https://auth.${new URL(siteUrl).hostname}`;
export const authorityOf = (siteUrl: string) => `${loginOrigin(siteUrl)}/pool`;

export async function serveSiteConfig(page: Page, siteUrl: string): Promise<void> {
  await page.route('**/config.json', (route) =>
    route.fulfill({
      json: { apiBaseUrl: API, cognitoAuthority: authorityOf(siteUrl), cognitoClientId: CLIENT_ID },
    }),
  );
}

/** Para `test.beforeEach(useSiteConfig)` nos arquivos que não simulam o backend. */
export async function useSiteConfig({ page, baseURL }: { page: Page; baseURL?: string }) {
  if (baseURL === undefined) throw new Error('baseURL não configurada');
  await serveSiteConfig(page, baseURL);
}
