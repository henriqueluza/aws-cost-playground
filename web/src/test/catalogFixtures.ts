import { priceFileSchema, type PriceCatalog } from '../features/pricing';

export type RawPrice = {
  sku: string;
  tiers?: [string | null, string][];
  freeTier?: { quantity: string; pool?: string };
  minimumQuantity?: string;
};

/** Catálogo validado pelo schema real, como o motor o recebe. */
export function catalogOf(services: Record<string, RawPrice[]>): PriceCatalog {
  const files = Object.entries(services).map(([service, prices]) =>
    priceFileSchema.parse({
      schemaVersion: 1,
      service,
      region: 'us-east-1',
      currency: 'USD',
      prices: prices.map(({ tiers = [[null, '1']], ...price }) => ({
        ...price,
        description: '',
        unit: 'unit',
        tiers: tiers.map(([upTo, unitPrice]) => ({ upTo, unitPrice })),
      })),
    }),
  );
  return {
    region: 'us-east-1',
    manifest: { schemaVersion: 1, source: 'seed', generatedAt: '2026-11-23T12:00:00Z', files: [] },
    services: new Map(files.map((file) => [file.service, file])),
  };
}
