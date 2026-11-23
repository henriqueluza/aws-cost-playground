import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { fontLicenses } from './tooling/fontLicenses.ts';
import { noDataUri } from './tooling/noDataUri.ts';

export default defineConfig({
  plugins: [react(), fontLicenses(), noDataUri()],
  // Sem URI `data:` no bundle: a CSP não libera `data:` (font-src e img-src só 'self').
  build: { assetsInlineLimit: 0 },
  test: { environment: 'jsdom', setupFiles: ['./src/test/setup.ts'] },
});
