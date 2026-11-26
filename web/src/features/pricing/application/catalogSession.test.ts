// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { CatalogError, createCatalogSession, type CatalogLoader, type PriceCatalog } from '..';
import { catalogOf } from '../../../test/catalogFixtures';

const catalog = catalogOf({ lambda: [] });

function loaderThat(load: CatalogLoader['load']): CatalogLoader {
  return { manifest: () => Promise.resolve(catalog.manifest), load: vi.fn(load) };
}
const ok = () => loaderThat(() => Promise.resolve(catalog));
const failing = (error: unknown) => loaderThat(() => Promise.reject(error));
/** Fábrica que entrega os carregadores dados, na ordem. */
function sequence(...loaders: CatalogLoader[]) {
  return vi.fn(() => {
    const next = loaders.shift();
    if (!next) throw new Error('carregador a mais');
    return next;
  });
}

describe('createCatalogSession', () => {
  it('usa um só carregador em todas as cargas', async () => {
    const loader = ok();
    const newLoader = sequence(loader);
    const load = createCatalogSession(newLoader);
    await expect(load('us-east-1', ['lambda'])).resolves.toBe(catalog);
    await load('sa-east-1', ['s3']);
    expect(newLoader).toHaveBeenCalledTimes(1);
    expect(loader.load).toHaveBeenNthCalledWith(2, 'sa-east-1', ['s3']);
  });

  it('com erro de integridade, troca o carregador e tenta uma vez', async () => {
    const [stale, fresh] = [failing(new CatalogError('integrity')), ok()];
    const newLoader = sequence(stale, fresh);
    const load = createCatalogSession(newLoader);
    await expect(load('us-east-1', ['lambda'])).resolves.toBe(catalog);
    await load('us-east-1', ['lambda']);
    expect(newLoader).toHaveBeenCalledTimes(2);
    expect(stale.load).toHaveBeenCalledTimes(1);
    expect(fresh.load).toHaveBeenCalledTimes(2);
  });

  it('se o carregador novo também falha, o erro sai sem outra tentativa', async () => {
    const second = failing(new CatalogError('integrity'));
    const newLoader = sequence(failing(new CatalogError('integrity')), second);
    const load = createCatalogSession(newLoader);
    await expect(load('us-east-1', ['lambda'])).rejects.toMatchObject({ kind: 'integrity' });
    expect(second.load).toHaveBeenCalledTimes(1);
    expect(newLoader).toHaveBeenCalledTimes(2);
  });

  it('cargas simultâneas com erro de integridade trocam o carregador uma só vez', async () => {
    const newLoader = sequence(failing(new CatalogError('integrity')), ok());
    const load = createCatalogSession(newLoader);
    const loaded: PriceCatalog[] = await Promise.all([
      load('us-east-1', ['lambda']),
      load('us-east-1', ['s3']),
    ]);
    expect(loaded).toEqual([catalog, catalog]);
    expect(newLoader).toHaveBeenCalledTimes(2);
  });

  it.each(['network', 'missing', 'too-large', 'invalid'] as const)(
    'erro `%s` não troca o carregador',
    async (kind) => {
      const newLoader = sequence(failing(new CatalogError(kind)));
      const load = createCatalogSession(newLoader);
      await expect(load('us-east-1', ['lambda'])).rejects.toMatchObject({ kind });
      expect(newLoader).toHaveBeenCalledTimes(1);
    },
  );
});
