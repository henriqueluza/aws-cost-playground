import { defineConfig } from '@playwright/test';

const port = Number(process.env.E2E_PORT ?? 4173);
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
const ci = process.env.CI !== undefined;
const preview = `npx vite preview --port ${port} --strictPort`;

/**
 * Testes de ponta a ponta (`npx playwright test`). Os arquivos são `*.e2e.ts` para o Vitest não os
 * pegar. Rodam contra o build de produção servido pelo `vite preview` (cliente HTTP real, sem o
 * fake de desenvolvimento): fora do CI o build é refeito antes; no CI o passo anterior já o fez.
 * `E2E_PORT` troca a porta e `PLAYWRIGHT_CHROMIUM_PATH` aponta para um Chromium já instalado.
 */
export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.e2e.ts',
  forbidOnly: ci,
  reporter: ci ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'retain-on-failure',
    launchOptions: executablePath === undefined ? {} : { executablePath },
  },
  webServer: {
    command: ci ? preview : `npm run build && ${preview}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !ci,
  },
});
