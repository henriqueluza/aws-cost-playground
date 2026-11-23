import { describe, expect, it } from 'vitest';
import { readRepoFile } from '../../test/css';

const indexDoc = () => new DOMParser().parseFromString(readRepoFile('web/index.html'), 'text/html');

describe('index.html', () => {
  it('carrega /theme.js no head, sem defer, async nem type', () => {
    const script = indexDoc().head.querySelector('script[src="/theme.js"]');
    expect(script).not.toBeNull();
    for (const attr of ['defer', 'async', 'type']) expect(script?.hasAttribute(attr)).toBe(false);
  });

  it('theme.js vem antes de qualquer stylesheet ou script de módulo', () => {
    const nodes = [...indexDoc().querySelectorAll('script, link[rel="stylesheet"]')];
    const theme = nodes.findIndex((n) => n.getAttribute('src') === '/theme.js');
    const others = nodes.flatMap((n, i) =>
      n.matches('link[rel="stylesheet"], script[type="module"]') ? [i] : [],
    );
    expect(theme).toBeGreaterThanOrEqual(0);
    for (const i of others) expect(theme).toBeLessThan(i);
  });

  it('nenhum script é inline', () => {
    const scripts = [...indexDoc().querySelectorAll('script')];
    expect(scripts.length).toBeGreaterThan(0);
    for (const s of scripts) expect(s.hasAttribute('src')).toBe(true);
  });
});

describe('integração do estilo global', () => {
  it('global.css importa tokens antes de base', () => {
    const css = readRepoFile('web/src/shared/ui/global.css');
    const tokens = css.indexOf("'./tokens.css'");
    const base = css.indexOf("'./base.css'");
    expect(tokens).toBeGreaterThanOrEqual(0);
    expect(base).toBeGreaterThan(tokens);
  });

  it('main.tsx importa o global.css', () => {
    expect(readRepoFile('web/src/main.tsx')).toMatch(
      /import\s+['"]\.\/shared\/ui\/global\.css['"]/,
    );
  });
});
