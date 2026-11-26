// @vitest-environment node
import { describe, expect, it } from 'vitest';

/**
 * Invariantes de segurança do código do site, fixados pela revisão da #73 (T4 e T5 do ADR):
 * nenhum sorvedouro de HTML ou de código, e nenhum armazenamento do navegador além dos dois
 * usos de `sessionStorage` que não guardam token. Lê o código de produção como texto.
 */
const raw = import.meta.glob<string>('./**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const stripComments = (code: string) =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const production = Object.entries(raw)
  .filter(([path]) => !/\.test\.tsx?$|^\.\/test\//.test(path))
  .map(([path, code]) => [path, stripComments(code)] as const);

const sinks: Record<string, RegExp> = {
  dangerouslySetInnerHTML: /dangerouslySetInnerHTML/,
  'innerHTML / outerHTML': /\b(inner|outer)HTML\b/,
  insertAdjacentHTML: /insertAdjacentHTML/,
  'document.write': /document\.write/,
  eval: /\beval\s*\(/,
  'new Function': /new\s+Function\b/,
  srcDoc: /srcdoc/i,
  'window.open': /\bwindow\.open\b|\bopen\s*\(\s*['"`]https?:/,
  postMessage: /postMessage/,
  'URL javascript:': /javascript:/i,
  console: /\bconsole\.\w+/,
};

const storage: Record<string, RegExp> = {
  localStorage: /localStorage/,
  indexedDB: /indexedDB/i,
  cookie: /document\.cookie|cookieStore/,
};

// Os dois usos aceitos: a tentativa de login (state, PKCE, nonce) e o rascunho do design.
const sessionStorageUsers = [
  './features/auth/infrastructure/sessionAttemptStore.ts',
  './features/editor/model/designDraft.ts',
];

const offenders = (pattern: RegExp) =>
  production.filter(([, code]) => pattern.test(code)).map(([path]) => path);

describe('invariantes de segurança do código do site', () => {
  it('lê o código de produção inteiro, sem os testes', () => {
    // Piso folgado (hoje são mais de 250): só garante que o glob não voltou vazio.
    expect(production.length).toBeGreaterThan(200);
    expect(production.map(([path]) => path)).toContain(
      './features/auth/infrastructure/memorySessionStore.ts',
    );
    expect(production.some(([path]) => path.includes('.test.'))).toBe(false);
  });

  it.each(Object.entries(sinks))('nenhum arquivo usa %s', (_name, pattern) => {
    expect(offenders(pattern)).toEqual([]);
  });

  it.each(Object.entries(storage))('nenhum arquivo usa %s', (_name, pattern) => {
    expect(offenders(pattern)).toEqual([]);
  });

  it('sessionStorage só na tentativa de login e no rascunho do design', () => {
    expect(offenders(/sessionStorage/).sort()).toEqual(sessionStorageUsers);
  });

  it('nenhum arquivo de sessão ou de transporte toca em armazenamento', () => {
    const sensitive = production.filter(([path]) =>
      /memorySessionStore|\/http\/transport|authService/.test(path),
    );
    expect(sensitive.length).toBeGreaterThanOrEqual(3);
    for (const [, code] of sensitive) expect(code).not.toMatch(/Storage\b/);
  });

  it.each([
    ['dangerouslySetInnerHTML', '<div dangerouslySetInnerHTML={{ __html: label }} />'],
    ['innerHTML / outerHTML', 'node.innerHTML = label;'],
    ['eval', 'eval(code);'],
    ['new Function', 'const f = new Function(code);'],
    ['URL javascript:', "const href = 'javascript:alert(1)';"],
    ['console', 'console.log(token);'],
  ])('o padrão de %s pega o trecho hostil', (name, snippet) => {
    expect(sinks[name]?.test(snippet)).toBe(true);
  });

  it('comentário que cita um sorvedouro não conta', () => {
    expect(stripComments('/** nunca em `localStorage` */\n// innerHTML\nconst a = 1;')).not.toMatch(
      /localStorage|innerHTML/,
    );
  });
});
