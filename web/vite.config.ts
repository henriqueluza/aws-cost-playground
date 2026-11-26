import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import { fontLicenses } from './tooling/fontLicenses.ts';
import { noDataUri } from './tooling/noDataUri.ts';
import { parseSiteUrl, seo } from './tooling/seo.ts';

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    fontLicenses(),
    noDataUri(),
    seo(parseSiteUrl(loadEnv(mode, process.cwd(), 'VITE_').VITE_SITE_URL)),
  ],
  // Sem URI `data:` no bundle: a CSP não libera `data:` (font-src e img-src só 'self').
  build: { assetsInlineLimit: 0 },
  test: { environment: 'jsdom', setupFiles: ['./src/test/setup.ts'] },
}));
