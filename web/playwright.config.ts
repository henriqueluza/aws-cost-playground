import { defineConfig } from '@playwright/test';

const port = Number(process.env.E2E_PORT ?? 5173);
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;

/**
 * Testes de ponta a ponta (`npx playwright test`). Os arquivos são `*.e2e.ts` para o Vitest não os
 * pegar. Sobe o servidor de desenvolvimento, ou reaproveita o que já responde na porta.
 * `PLAYWRIGHT_CHROMIUM_PATH` aponta para um Chromium já instalado (opcional).
 */
export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.e2e.ts',
  use: {
    baseURL: `http://localhost:${port}`,
    launchOptions: executablePath === undefined ? {} : { executablePath },
  },
  webServer: {
    command: `npm run dev -- --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: true,
  },
});
