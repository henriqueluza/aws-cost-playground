import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
it('probe', () => {
  const before = Object.keys(globalThis);
  const beforeW = Object.keys(window);
  new Function('globalThis.__a = 1; window.__b = 1; var __c = 1;')();
  (0, eval)('var __d = 1; function __e() {}');
  writeFileSync('/tmp/probe-109.txt', JSON.stringify({ same: window === (globalThis as unknown), g: Object.keys(globalThis).filter((k) => !before.includes(k)), w: Object.keys(window).filter((k) => !beforeW.includes(k)), ownA: Object.prototype.hasOwnProperty.call(globalThis, '__a') }));
});
