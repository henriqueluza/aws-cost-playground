import { REGIONS } from '../../../shared/lib/design';
import { CatalogError, type ReadPriceFile } from '../application/loadCatalog';

/** Pasta do catálogo, na origem do próprio site. */
const PRICES_PATH = '/prices/';
/** Teto de um arquivo do catálogo (corpo já decodificado), aplicado durante a leitura. */
export const MAX_PRICE_FILE_BYTES = 512 * 1024;
export const PRICE_FILE_TIMEOUT_MS = 10_000;

/** Só `manifest.json` e `<region>/<service>.json`, com região conhecida e serviço em slug. */
const CATALOG_PATH = new RegExp(
  `^(?:manifest|(?:${REGIONS.join('|')})/[a-z][a-z0-9-]{0,39})\\.json$`,
);

/** URL do arquivo; `invalid` para o que foge da allowlist ou sai de `/prices/` na mesma origem. */
function priceFileUrl(path: string): URL {
  if (typeof path !== 'string' || !CATALOG_PATH.test(path)) throw new CatalogError('invalid');
  try {
    const { origin } = globalThis.location;
    const url = new URL(PRICES_PATH + path, origin);
    if (url.origin === origin && url.href === `${origin}${PRICES_PATH}${path}`) return url;
  } catch {
    // Origem opaca ou ausente: cai na recusa abaixo.
  }
  throw new CatalogError('invalid');
}

/** Lê o corpo até `maxBytes`; ao passar do teto, cancela o stream (não confia no `Content-Length`). */
async function readCapped(response: Response, maxBytes: number): Promise<Uint8Array<ArrayBuffer>> {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new CatalogError('too-large');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export interface HttpPriceFilesOptions {
  /** Tempo limite da requisição inteira, corpo incluído. */
  timeoutMs?: number;
}

/**
 * Adaptador HTTP da porta `ReadPriceFile`: busca `/prices/<path>` na origem do próprio site, sem
 * credenciais e sem seguir redirecionamento. Toda falha sai como `CatalogError`, sem `cause`.
 */
export function httpPriceFiles({
  timeoutMs = PRICE_FILE_TIMEOUT_MS,
}: HttpPriceFilesOptions = {}): ReadPriceFile {
  return async (path) => {
    try {
      const response = await fetch(priceFileUrl(path), {
        method: 'GET',
        mode: 'same-origin',
        cache: 'no-cache',
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.status !== 200 || response.redirected) {
        await response.body?.cancel().catch(() => undefined);
        throw new CatalogError(response.status === 404 ? 'missing' : 'network');
      }
      return await readCapped(response, MAX_PRICE_FILE_BYTES);
    } catch (error) {
      // Sem `cause`: o erro do `fetch` pode trazer a URL e o do corpo, texto do servidor.
      throw error instanceof CatalogError ? error : new CatalogError('network');
    }
  };
}
