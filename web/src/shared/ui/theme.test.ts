import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// jsdom: import.meta.url não é file://; o vitest roda com cwd em web/.
const src = readFileSync(resolve(process.cwd(), 'public/theme.js'), 'utf8');
const applied = () => document.documentElement.dataset.theme;

/** matchMedia falso: `matches` inicial do sistema e acesso ao listener registrado. */
function run(systemDark: boolean) {
  let listener: ((e: { matches: boolean }) => void) | undefined;
  const mql = {
    matches: systemDark,
    addEventListener: (type: string, fn: typeof listener) => {
      if (type === 'change') listener = fn;
    },
  };
  vi.stubGlobal('matchMedia', (q: string) => (q === '(prefers-color-scheme: dark)' ? mql : {}));
  new Function(src)();
  return (matches: boolean) => listener?.({ matches });
}

afterEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('theme.js', () => {
  it.each([
    ['dark', false, 'dark'],
    ['light', true, 'light'],
    [null, false, 'light'],
    [null, true, 'dark'],
    ['sepia', true, 'dark'],
    ['', false, 'light'],
  ])('salvo %j com sistema escuro=%s aplica %s', (saved, systemDark, expected) => {
    if (saved !== null) localStorage.setItem('acp-theme', saved);
    run(systemDark);
    expect(applied()).toBe(expected);
  });

  it('leitura do storage que lança segue o sistema', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    run(true);
    expect(applied()).toBe('dark');
  });

  it('mudança do sistema troca o tema quando não há escolha', () => {
    const change = run(false);
    change(true);
    expect(applied()).toBe('dark');
    change(false);
    expect(applied()).toBe('light');
  });

  it('mudança do sistema não sobrepõe a escolha salva', () => {
    localStorage.setItem('acp-theme', 'light');
    const change = run(false);
    change(true);
    expect(applied()).toBe('light');
  });
});
