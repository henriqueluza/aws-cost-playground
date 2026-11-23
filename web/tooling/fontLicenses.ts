import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { Plugin } from 'vite';

const require = createRequire(import.meta.url);
const FAMILIES = ['ibm-plex-sans', 'ibm-plex-mono'] as const;

/** Emite a licença SIL OFL 1.1 de cada pacote de fonte em `dist/fonts/`, junto com os woff2. */
export function fontLicenses(): Plugin {
  return {
    name: 'font-licenses',
    generateBundle() {
      for (const family of FAMILIES) {
        const source = readFileSync(require.resolve(`@fontsource/${family}/LICENSE`), 'utf8');
        this.emitFile({ type: 'asset', fileName: `fonts/OFL-${family}.txt`, source });
      }
    },
  };
}
