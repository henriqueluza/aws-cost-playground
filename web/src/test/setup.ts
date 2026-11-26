import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(cleanup);

// O jsdom não traz o que o React Flow mede: ResizeObserver e DOMMatrixReadOnly.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub;
globalThis.DOMMatrixReadOnly ??= class {
  m22 = 1;
  constructor(transform?: string) {
    const scale = /scale\(([\d.]+)\)/.exec(transform ?? '');
    if (scale?.[1]) this.m22 = Number(scale[1]);
  }
} as unknown as typeof DOMMatrixReadOnly;
