// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (path: string): string =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
const blocks = [...read('../../../../DESIGN.md').matchAll(/^```css\n([\s\S]*?)^```$/gm)].map(
  (m) => m[1] ?? '',
);
const css = read('./tokens.css').replace(/^\/\*[\s\S]*?\*\/\n\n/, '');

/** Declarações `--nome: valor` de todas as regras com o seletor exato, na ordem. */
function declarations(selector: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const rule of css.matchAll(/^([^{}\n]+?)\s*\{([^}]*)\}/gm)) {
    if (rule[1]?.trim() !== selector) continue;
    const body = (rule[2] ?? '').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const d of body.matchAll(/(--[\w-]+|color-scheme)\s*:\s*([^;]+);/g)) {
      found.set(d[1] ?? '', (d[2] ?? '').trim());
    }
  }
  return found;
}

describe('tokens.css', () => {
  const light = declarations(':root');
  const dark = declarations(':root[data-theme="dark"]');

  it('espelha os blocos css do DESIGN.md, sem divergência de nome ou valor', () => {
    expect(blocks.length).toBeGreaterThanOrEqual(7);
    expect(css).toBe(blocks.join('\n'));
  });

  it('o escuro não cria token órfão e redefine todo token de cor literal do claro', () => {
    const custom = (m: Map<string, string>) => [...m.keys()].filter((k) => k.startsWith('--'));
    expect(custom(dark).filter((k) => !light.has(k))).toEqual([]);
    const literalColors = custom(light).filter((k) => /^(#|rgb)/.test(light.get(k) ?? ''));
    expect(literalColors.filter((k) => !dark.has(k))).toEqual([]);
  });

  it('declara color-scheme coerente com cada tema', () => {
    expect(light.get('color-scheme')).toBe('light');
    expect(dark.get('color-scheme')).toBe('dark');
  });
});
