import { expect, test, type Page } from '@playwright/test';
import { API, authorityOf, CLIENT_ID, useSiteConfig } from './support/siteConfig';

/**
 * O que o build de produção (o servido pelo `vite preview`) aceita no `/config.json`. `http://` em
 * `localhost` só existe no servidor de desenvolvimento: aqui tem de dar a tela de erro, inclusive
 * com o `public/config.json` de desenvolvimento, que vai junto no build.
 */
const configError = (page: Page) =>
  page.getByRole('alert').filter({ hasText: 'Não foi possível carregar a configuração' });
const editor = (page: Page) => page.getByRole('application', { name: 'Diagrama da arquitetura' });

test('o build de produção recusa o config.json de desenvolvimento (http em localhost)', async ({
  page,
}) => {
  const served = (await (await page.request.get('/config.json')).json()) as Record<string, string>;
  expect(served.apiBaseUrl).toMatch(/^http:\/\/localhost/);
  await page.goto('/');
  await expect(configError(page)).toBeVisible();
  await expect(editor(page)).toHaveCount(0);
});

for (const [field, value] of [
  ['apiBaseUrl', 'http://localhost:8000'],
  ['apiBaseUrl', 'http://127.0.0.1:8000'],
  ['cognitoAuthority', 'http://localhost:9229/local_pool'],
] as const) {
  test(`o build de produção recusa ${field} em ${value}`, async ({ page, baseURL }) => {
    if (baseURL === undefined) throw new Error('baseURL não configurada');
    const config = {
      apiBaseUrl: API,
      cognitoAuthority: authorityOf(baseURL),
      cognitoClientId: CLIENT_ID,
    };
    await page.route('**/config.json', (route) =>
      route.fulfill({ json: { ...config, [field]: value } }),
    );
    await page.goto('/');
    await expect(configError(page)).toBeVisible();
    await expect(editor(page)).toHaveCount(0);
  });
}

test('com a configuração https o mesmo build abre o editor', async ({ page, baseURL }) => {
  await useSiteConfig({ page, baseURL });
  await page.goto('/');
  await expect(editor(page)).toBeVisible();
  await expect(configError(page)).toHaveCount(0);
});
