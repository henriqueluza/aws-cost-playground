import type { Plugin } from 'vite';

// Forma com tipo MIME: o bundle usa `data:` como chave de objeto JS, que não é URI.
const DATA_URI = /data:[a-z]+\/[a-z0-9.+-]+[;,]/i;

/** Primeiro URI `data:` encontrado no texto, ou `null`. */
export function findDataUri(text: string): string | null {
  return DATA_URI.exec(text)?.[0] ?? null;
}

/** Falha o build se algum chunk ou asset de texto contiver URI `data:` (CSP sem `data:`). */
export function noDataUri(): Plugin {
  return {
    name: 'no-data-uri',
    generateBundle(_options, bundle) {
      for (const [name, item] of Object.entries(bundle)) {
        const text = item.type === 'chunk' ? item.code : item.source;
        if (typeof text !== 'string') continue; // binário (woff2) não é texto
        const hit = findDataUri(text);
        if (hit) this.error(`URI data: proibido no build (${hit}…) em ${name}`);
      }
    },
  };
}
