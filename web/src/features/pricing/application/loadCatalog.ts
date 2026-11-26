import type { z } from 'zod';
import type { Region } from '../../../shared/lib/design';
import { priceFileSchema, priceManifestSchema } from '../model/catalog';
import type { PriceCatalog, PriceManifest } from '../model/catalog';

/** `missing`: arquivo listado no manifest que não existe; `integrity`: `sha256` diferente do manifest. */
export type CatalogErrorKind = 'network' | 'missing' | 'too-large' | 'invalid' | 'integrity';

/** Erro tipado da carga do catálogo. A mensagem é fixa e não ecoa o conteúdo do arquivo. */
export class CatalogError extends Error {
  readonly kind: CatalogErrorKind;

  constructor(kind: CatalogErrorKind, options?: ErrorOptions) {
    super(`Erro do catálogo de preços: ${kind}.`, options);
    this.name = 'CatalogError';
    this.kind = kind;
  }
}

/** Porta: bytes de um arquivo de `public/prices/`, pelo caminho relativo. Lança `CatalogError`. */
export type ReadPriceFile = (path: string) => Promise<Uint8Array<ArrayBuffer>>;

export interface CatalogLoader {
  /** Lido uma vez; traz a data e a origem (`seed` ou `price-list`) para o aviso do editor. */
  manifest(): Promise<PriceManifest>;
  /** Só os serviços pedidos, na região pedida. Serviço fora do manifest fica fora do mapa. */
  load(region: Region, services: readonly string[]): Promise<PriceCatalog>;
}

function parse<S extends z.ZodType>(schema: S, bytes: Uint8Array): z.output<S> {
  try {
    return schema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  } catch (cause) {
    throw new CatalogError('invalid', { cause });
  }
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function createCatalogLoader(read: ReadPriceFile): CatalogLoader {
  let cached: Promise<PriceManifest> | undefined;
  const manifest = (): Promise<PriceManifest> => {
    cached ??= read('manifest.json').then((bytes) => parse(priceManifestSchema, bytes));
    // Falha não fica guardada: a próxima chamada tenta de novo.
    cached.catch(() => (cached = undefined));
    return cached;
  };
  return {
    manifest,
    async load(region, services) {
      const current = await manifest();
      const wanted = new Set(services.map((service) => `${region}/${service}.json`));
      const loaded = await Promise.all(
        current.files
          .filter((file) => wanted.has(file.path))
          .map(async ({ path, sha256 }) => {
            const bytes = await read(path);
            if ((await sha256Hex(bytes)) !== sha256) throw new CatalogError('integrity');
            const file = parse(priceFileSchema, bytes);
            if (`${file.region}/${file.service}.json` !== path) throw new CatalogError('invalid');
            return [file.service, file] as const;
          }),
      );
      return { region, manifest: current, services: new Map(loaded) };
    },
  };
}
