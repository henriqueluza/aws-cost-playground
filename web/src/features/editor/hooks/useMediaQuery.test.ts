import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useMediaQuery } from './useMediaQuery';

function stubMatchMedia(initial: boolean) {
  const state = { matches: initial };
  const listeners = new Set<() => void>();
  const add = vi.fn((_type: string, fn: () => void) => listeners.add(fn));
  const remove = vi.fn((_type: string, fn: () => void) => listeners.delete(fn));
  const matchMedia = vi.fn((query: string) => ({
    get matches() {
      return state.matches;
    },
    media: query,
    addEventListener: add,
    removeEventListener: remove,
  }));
  vi.stubGlobal('matchMedia', matchMedia);
  return {
    matchMedia,
    add,
    remove,
    listeners,
    change(next: boolean) {
      state.matches = next;
      act(() => listeners.forEach((fn) => fn()));
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('useMediaQuery', () => {
  it.each([true, false])('devolve o matches da lista (%s), ignorando o fallback', (matches) => {
    stubMatchMedia(matches);
    const { result } = renderHook(() => useMediaQuery('(min-width: 1024px)', !matches));
    expect(result.current).toBe(matches);
  });

  it('reage ao evento change', () => {
    const media = stubMatchMedia(false);
    const { result } = renderHook(() => useMediaQuery('(min-width: 1024px)', true));
    expect(result.current).toBe(false);
    media.change(true);
    expect(result.current).toBe(true);
    media.change(false);
    expect(result.current).toBe(false);
  });

  it.each([true, false])('usa o fallback (%s) sem window.matchMedia', (fallback) => {
    vi.stubGlobal('matchMedia', undefined);
    const { result } = renderHook(() => useMediaQuery('(min-width: 1024px)', fallback));
    expect(result.current).toBe(fallback);
  });

  it('remove o listener no unmount', () => {
    const media = stubMatchMedia(true);
    const { unmount } = renderHook(() => useMediaQuery('(min-width: 1024px)', false));
    expect(media.listeners.size).toBe(1);
    unmount();
    expect(media.remove).toHaveBeenCalledWith('change', expect.any(Function));
    expect(media.listeners.size).toBe(0);
  });

  it('reassina quando a query muda', () => {
    const media = stubMatchMedia(true);
    const { rerender } = renderHook(({ q }) => useMediaQuery(q, false), {
      initialProps: { q: '(min-width: 1024px)' },
    });
    rerender({ q: '(min-width: 600px)' });
    expect(media.matchMedia).toHaveBeenCalledWith('(min-width: 600px)');
    expect(media.remove).toHaveBeenCalledTimes(1);
    expect(media.listeners.size).toBe(1);
  });
});
