import { z } from 'zod';
import { REGIONS, type Region } from '../../../shared/lib/design';
import { compare, decimal, type Decimal } from '../../../shared/lib/money';

/** Limites dos arquivos de preço, que são entrada não confiável como o documento do design. */
export const CATALOG_LIMITS = {
  maxPricesPerFile: 200,
  maxTiersPerPrice: 16,
  maxFilesInManifest: 100,
  maxDescriptionLength: 200,
  maxUnitLength: 40,
} as const;

/**
 * Preço ou quantidade: string decimal sem sinal nem expoente, com até 15 dígitos inteiros e
 * 12 casas. O formato é conferido antes de `decimal()`, que arredondaria além de 12 casas.
 */
const decimalString = z
  .string()
  .regex(/^\d{1,15}(?:\.\d{1,12})?$/)
  .transform((text): Decimal => decimal(text));

/** Nome de serviço e de `pool`: vira nome de arquivo, então é minúsculo e sem `/` nem `.`. */
const slug = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/);
const ZERO = decimal(0);

const tierSchema = z.object({
  /** Limite superior cumulativo da faixa; `null` na última, que não tem teto. */
  upTo: decimalString.nullable(),
  unitPrice: decimalString,
});

const priceSchema = z
  .object({
    sku: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/),
    description: z.string().max(CATALOG_LIMITS.maxDescriptionLength),
    unit: z.string().min(1).max(CATALOG_LIMITS.maxUnitLength),
    tiers: z.array(tierSchema).min(1).max(CATALOG_LIMITS.maxTiersPerPrice),
    /** Quantidade gratuita por mês; `pool` junta SKUs que dividem a mesma franquia. */
    freeTier: z.object({ quantity: decimalString, pool: slug.optional() }).optional(),
    /** Quantidade mínima cobrada (ex.: duração mínima de uma requisição). */
    minimumQuantity: decimalString.optional(),
  })
  .superRefine((price, ctx) => {
    const last = price.tiers.length - 1;
    let previous = ZERO;
    price.tiers.forEach((tier, i) => {
      const path = ['tiers', i, 'upTo'];
      if (tier.upTo === null) {
        if (i !== last)
          ctx.addIssue({ code: 'custom', path, message: 'Só a última faixa é aberta.' });
        return;
      }
      if (i === last) ctx.addIssue({ code: 'custom', path, message: 'A última faixa é aberta.' });
      if (compare(tier.upTo, previous) <= 0) {
        ctx.addIssue({ code: 'custom', path, message: 'Faixas fora de ordem crescente.' });
      }
      previous = tier.upTo;
    });
  });

/**
 * Arquivo de preço de um serviço numa região (`public/prices/<region>/<service>.json`).
 * Leitura tolerante como a do design: chave desconhecida é descartada, não recusada.
 */
export const priceFileSchema = z
  .object({
    schemaVersion: z.literal(1),
    service: slug,
    region: z.enum(REGIONS),
    currency: z.literal('USD'),
    prices: z.array(priceSchema).max(CATALOG_LIMITS.maxPricesPerFile),
  })
  .superRefine((file, ctx) => {
    const skus = new Set<string>();
    file.prices.forEach((price, i) => {
      if (skus.has(price.sku)) {
        ctx.addIssue({ code: 'custom', path: ['prices', i, 'sku'], message: 'SKU repetido.' });
      }
      skus.add(price.sku);
    });
  });

const filePath = new RegExp(`^(?:${REGIONS.join('|')})/[a-z][a-z0-9-]{0,39}\\.json$`);

/** `public/prices/manifest.json`: de onde vieram os preços, quando, e o hash de cada arquivo. */
export const priceManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    /** `seed`: valores escritos à mão no repositório; `price-list`: gerados pelo `pricing/`. */
    source: z.enum(['seed', 'price-list']),
    /** ISO 8601 em UTC (`Z`). */
    generatedAt: z.iso.datetime(),
    files: z
      .array(
        z.object({
          /** `<region>/<service>.json`, relativo a `public/prices/`. */
          path: z.string().regex(filePath),
          sha256: z.string().regex(/^[0-9a-f]{64}$/),
        }),
      )
      .max(CATALOG_LIMITS.maxFilesInManifest),
  })
  .superRefine((manifest, ctx) => {
    const paths = new Set<string>();
    manifest.files.forEach((file, i) => {
      if (paths.has(file.path)) {
        ctx.addIssue({ code: 'custom', path: ['files', i, 'path'], message: 'Arquivo repetido.' });
      }
      paths.add(file.path);
    });
  });

export type PriceTier = z.infer<typeof tierSchema>;
export type Price = z.infer<typeof priceSchema>;
export type PriceFile = z.infer<typeof priceFileSchema>;
export type PriceManifest = z.infer<typeof priceManifestSchema>;
export type PriceSource = PriceManifest['source'];

/** O que o motor recebe: os arquivos já validados de uma região, por nome de serviço. */
export interface PriceCatalog {
  readonly region: Region;
  readonly manifest: PriceManifest;
  readonly services: ReadonlyMap<string, PriceFile>;
}
