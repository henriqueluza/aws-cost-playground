// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REGIONS } from '../../../shared/lib/design';
import { toFixed } from '../../../shared/lib/money';
import { createCatalogLoader, priceManifestSchema } from '..';

/** Carregador real (zod + sha256) lendo do disco, no lugar do `fetch`. */
const loaderAt = (directory: string) =>
  createCatalogLoader(async (path) => new Uint8Array(await readFile(resolve(directory, path))));

describe('contrato com o gerador (pricing/)', () => {
  it('aceita o arquivo e o manifest que o gerador produz', async () => {
    // Bytes gerados por pricing/app/render.py; pricing/tests/test_seed_catalog.py os confere.
    const loader = loaderAt(resolve(import.meta.dirname, '__fixtures__/generator'));
    const { source, generatedAt } = await loader.manifest();
    expect([source, generatedAt]).toEqual(['price-list', '2026-11-23T12:00:00Z']);
    const lambda = (await loader.load('us-east-1', ['lambda'])).services.get('lambda');
    expect(lambda?.prices.map((price) => price.sku)).toEqual([
      'lambda-duration-x86',
      'lambda-requests',
    ]);
    const [duration, requests] = lambda!.prices;
    expect(duration!.tiers.map((tier) => tier.upTo && toFixed(tier.upTo, 0))).toEqual([
      '6000000000',
      '15000000000',
      null,
    ]);
    expect(toFixed(duration!.minimumQuantity!, 3)).toBe('0.001');
    expect(duration!.freeTier?.pool).toBeUndefined();
    expect(requests!.freeTier?.pool).toBe('lambda-requests');
  });

  it('aceita o catálogo versionado em public/prices, arquivo por arquivo', async () => {
    const directory = resolve(import.meta.dirname, '../../../../public/prices');
    const manifest = priceManifestSchema.parse(
      JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8')),
    );
    expect(manifest.files.length).toBeGreaterThan(0);
    for (const region of REGIONS) {
      const listed = manifest.files
        .filter((file) => file.path.startsWith(`${region}/`))
        .map((file) => file.path.slice(region.length + 1, -'.json'.length));
      const catalog = await loaderAt(directory).load(region, listed);
      expect([...catalog.services.keys()].sort()).toEqual([...listed].sort());
    }
  });
});
