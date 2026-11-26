import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { designDocumentSchema, type Block, type DesignDocument } from '../../../shared/lib/design';
import { catalogOf } from '../../../test/catalogFixtures';
import { adrExampleDesign } from '../../../test/designFixtures';
import { CatalogError } from '../application/loadCatalog';
import { useCostView } from './useCostView';
import type { PriceCatalogState } from './usePriceCatalog';

const design = designDocumentSchema.parse(adrExampleDesign);
const catalog = catalogOf({
  lambda: [
    {
      sku: 'lambda-requests-arm64',
      tiers: [[null, '0.0000002']],
      freeTier: { quantity: '1000000', pool: 'r' },
    },
    {
      sku: 'lambda-duration-arm64',
      tiers: [[null, '0.0000133334']],
      freeTier: { quantity: '400000', pool: 'd' },
    },
  ],
});
const ready = (updating = false): PriceCatalogState => ({
  status: 'ready',
  catalog,
  source: 'seed',
  generatedAt: '2026-11-23T12:00:00Z',
  updating,
});
const withBlocks = (n: number): DesignDocument => ({
  ...design,
  edges: [],
  blocks: Array.from({ length: n }, (_, i) => ({ ...(design.blocks[0] as Block), id: `blk_${i}` })),
});

describe('useCostView', () => {
  it('repassa idle e loading sem calcular', () => {
    expect(renderHook(() => useCostView(design, { status: 'idle' })).result.current).toEqual({
      status: 'idle',
    });
    expect(renderHook(() => useCostView(design, { status: 'loading' })).result.current).toEqual({
      status: 'loading',
    });
  });

  it('no erro, devolve o tipo e o retry, nunca a mensagem', () => {
    const retry = () => {};
    const { result } = renderHook(() =>
      useCostView(design, { status: 'error', error: new CatalogError('missing'), retry }),
    );
    expect(result.current).toEqual({ status: 'error', kind: 'missing', retry });
  });

  it('pronto, calcula o motor e prepara as linhas', () => {
    const { result } = renderHook(() => useCostView(design, ready()));
    if (result.current.status !== 'ready') throw new Error('esperava ready');
    expect(result.current.updating).toBe(false);
    expect(result.current.rows.blocks.map((r) => r.id)).toEqual(['blk_fn_api', 'blk_assets']);
    // Uploads (S3) e a aresta Uploads → Internet não têm SKU no catálogo só com Lambda.
    expect(result.current.rows.unavailable).toBe(2);
  });

  it('memoiza pela identidade do design e do catálogo', () => {
    const state = ready();
    const { result, rerender } = renderHook(() => useCostView(design, state));
    const first = result.current;
    rerender();
    if (first.status !== 'ready' || result.current.status !== 'ready') throw new Error('ready');
    expect(result.current.estimate).toBe(first.estimate);
    expect(result.current.rows).toBe(first.rows);
  });

  it('com o catálogo a caminho, mantém o último resultado em vez de itens sem preço', () => {
    const { result, rerender } = renderHook(({ d, s }) => useCostView(d, s), {
      initialProps: { d: design, s: ready() },
    });
    if (result.current.status !== 'ready') throw new Error('ready');
    const settled = result.current.estimate;
    rerender({ d: withBlocks(2), s: ready(true) });
    if (result.current.status !== 'ready') throw new Error('ready');
    expect(result.current.updating).toBe(true);
    expect(result.current.estimate).toBe(settled);
  });

  it('com o catálogo a caminho e nada calculado ainda, fica em loading', () => {
    const { result } = renderHook(() => useCostView(design, ready(true)));
    expect(result.current).toEqual({ status: 'loading' });
  });

  it('recalcula 100 blocos dentro do orçamento de 100 ms da interface', () => {
    const big = withBlocks(100);
    const start = performance.now();
    const { result } = renderHook(() => useCostView(big, ready()));
    const elapsed = performance.now() - start;
    console.info(`recálculo com 100 blocos (hook, 1ª renderização): ${elapsed.toFixed(1)} ms`);
    if (result.current.status !== 'ready') throw new Error('ready');
    expect(result.current.rows.blocks).toHaveLength(100);
    expect(elapsed).toBeLessThan(100);
  });
});
