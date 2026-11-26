import { render, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiProvider, useApi } from './ApiProvider';
import { createInMemoryApi } from './inMemoryApi';
import type { Api } from './ports';

const limits = { maxDesigns: 1, maxDocBytes: 1, userDailyLimit: 1, globalDailyLimit: 1 };

describe('ApiProvider', () => {
  it('entrega a mesma instância a cada render', () => {
    const api = createInMemoryApi(limits);
    const seen: Api[] = [];
    function Probe() {
      seen.push(useApi());
      return null;
    }
    const tree = () => (
      <ApiProvider api={api}>
        <Probe />
      </ApiProvider>
    );
    const { rerender } = render(tree());
    rerender(tree());
    rerender(tree());
    expect(seen.length).toBeGreaterThanOrEqual(3);
    expect(seen.every((seenApi) => seenApi === api)).toBe(true);
  });

  it('useApi sem provider lança erro explícito', () => {
    const silence = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => renderHook(() => useApi())).toThrow(/useApi precisa de um <ApiProvider>/);
    } finally {
      silence.mockRestore();
    }
  });
});
