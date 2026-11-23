import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readRepoFile } from '../../test/css';

const KEY = 'acp-theme';
const html = document.documentElement;
const theme = () => html.getAttribute('data-theme');

type Listener = (event: { matches: boolean }) => void;

/** Instala um matchMedia falso; `change` dispara os listeners guardados. */
function stubSystem(dark: boolean) {
  const listeners: Listener[] = [];
  const mql = {
    matches: dark,
    media: '(prefers-color-scheme: dark)',
    addEventListener: (type: string, fn: Listener) => {
      if (type === 'change') listeners.push(fn);
    },
    removeEventListener: () => undefined,
  };
  vi.stubGlobal('matchMedia', () => mql);
  return {
    change(next: boolean) {
      mql.matches = next;
      for (const fn of listeners) fn({ matches: next });
    },
  };
}

/** Executa theme.js como script clássico, igual ao navegador. */
const run = () => {
  new Function(readRepoFile('web/public/theme.js'))();
};

describe('theme.js', () => {
  beforeEach(() => {
    localStorage.clear();
    html.removeAttribute('data-theme');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks(); // antes do clear: um teste troca o getter de localStorage
    localStorage.clear();
    html.removeAttribute('data-theme');
  });

  it('escolha salva dark vale com sistema claro', () => {
    stubSystem(false);
    localStorage.setItem(KEY, 'dark');
    run();
    expect(theme()).toBe('dark');
  });

  it('escolha salva light vale com sistema escuro', () => {
    stubSystem(true);
    localStorage.setItem(KEY, 'light');
    run();
    expect(theme()).toBe('light');
  });

  it.each([['blue'], [''], ['dark" onload="x'], ['DARK']])(
    'valor salvo inválido (%j) segue o sistema',
    (saved) => {
      stubSystem(true);
      localStorage.setItem(KEY, saved);
      run();
      expect(theme()).toBe('dark');
    },
  );

  it('valor inválido nunca vira o atributo, com sistema claro', () => {
    stubSystem(false);
    localStorage.setItem(KEY, 'dark" onload="x');
    run();
    expect(theme()).toBe('light');
  });

  it.each([
    [true, 'dark'],
    [false, 'light'],
  ])('sem escolha, sistema escuro=%s dá %s', (dark, expected) => {
    stubSystem(dark);
    run();
    expect(theme()).toBe(expected);
  });

  it('change sem escolha atualiza o atributo', () => {
    const system = stubSystem(false);
    run();
    system.change(true);
    expect(theme()).toBe('dark');
    system.change(false);
    expect(theme()).toBe('light');
  });

  it('change com escolha salva não muda nada', () => {
    const system = stubSystem(false);
    localStorage.setItem(KEY, 'light');
    run();
    system.change(true);
    expect(theme()).toBe('light');
  });

  it('escolha salva depois da carga passa a valer no próximo change', () => {
    const system = stubSystem(false);
    run();
    localStorage.setItem(KEY, 'light');
    system.change(true);
    expect(theme()).toBe('light');
  });

  it('localStorage que lança SecurityError segue o sistema, sem exceção', () => {
    const system = stubSystem(true);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('bloqueado', 'SecurityError');
    });
    expect(run).not.toThrow();
    expect(theme()).toBe('dark');
    expect(() => system.change(false)).not.toThrow();
    expect(theme()).toBe('light');
  });

  it('getter de localStorage que lança segue o sistema, sem exceção', () => {
    stubSystem(true);
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('bloqueado', 'SecurityError');
    });
    expect(run).not.toThrow();
    expect(theme()).toBe('dark');
  });

  it('sem matchMedia dá light, sem lançar', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(run).not.toThrow();
    expect(theme()).toBe('light');
  });

  it('matchMedia sem addEventListener ainda aplica o sistema, sem lançar', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    expect(run).not.toThrow();
    expect(theme()).toBe('dark');
  });

  it('não cria global novo', () => {
    stubSystem(false);
    const before = Object.keys(globalThis);
    run();
    expect(Object.keys(globalThis).filter((k) => !before.includes(k))).toEqual([]);
  });
});
