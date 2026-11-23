import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { readRepoFile } from '../../test/css';

// Prettier usa aspas simples e quebra o unicode-range em linhas: normaliza as duas coisas.
const css = readRepoFile('web/src/shared/ui/fonts.css')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replaceAll("'", '"')
  .replace(/\s+/g, ' ');
const require = createRequire(import.meta.url);

type Face = { family: string; weight: string; src: string; range: string; body: string };
const faces: Face[] = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map(([, body = '']) => {
  const get = (prop: string) => new RegExp(`${prop}:\\s*([^;]+);`).exec(body)?.[1]?.trim() ?? '';
  return {
    family: get('font-family').replaceAll('"', ''),
    weight: get('font-weight'),
    src: get('src'),
    range: get('unicode-range').replaceAll(', ', ','),
    body,
  };
});

const EXPECTED = [
  ...['400', '500', '600'].map((w) => ['IBM Plex Sans', w] as const),
  ...['400', '500'].map((w) => ['IBM Plex Mono', w] as const),
];

describe('fonts.css', () => {
  it('declara as 10 faces: Sans 400/500/600 e Mono 400/500, em latin e latin-ext', () => {
    expect(faces).toHaveLength(10);
    for (const [family, weight] of EXPECTED) {
      expect(faces.filter((f) => f.family === family && f.weight === weight)).toHaveLength(2);
    }
  });

  it('toda url() é woff2 local, sem http nem //', () => {
    const urls = [...css.matchAll(/url\(([^)]*)\)/g)].map((m) => (m[1] ?? '').replace(/["']/g, ''));
    expect(urls).toHaveLength(10);
    for (const url of urls) {
      expect(url).toMatch(/^@fontsource\/ibm-plex-(sans|mono)\/files\/[a-z0-9-]+\.woff2$/);
    }
    expect(css).not.toMatch(/https?:|\/\//);
    expect(css).not.toMatch(/data:/);
  });

  it('só formato woff2, com font-display swap', () => {
    for (const f of faces) {
      expect(f.src).toMatch(/format\("woff2"\)$/);
      expect(f.body).toMatch(/font-display:\s*swap;/);
      expect(f.body).toMatch(/font-style:\s*normal;/);
    }
  });

  it('cada url aponta para um arquivo que existe no pacote e o unicode-range vem do unicode.json', () => {
    for (const f of faces) {
      const [, pkg, file] = /url\("@fontsource\/([^/]+)\/files\/([^"]+)"\)/.exec(f.src) ?? [];
      expect(pkg).toBeTruthy();
      const subset = /-(latin(?:-ext)?)-\d+-normal\.woff2$/.exec(file ?? '')?.[1] ?? '';
      expect(file).toContain(f.weight);
      expect(() => require.resolve(`@fontsource/${pkg}/files/${file}`)).not.toThrow();
      const unicode = JSON.parse(
        readFileSync(require.resolve(`@fontsource/${pkg}/unicode.json`), 'utf8'),
      ) as Record<string, string>;
      expect(f.range).toBe(unicode[subset]);
    }
  });

  it('os tokens declaram as duas famílias e global.css importa fonts.css primeiro', () => {
    const tokens = readRepoFile('web/src/shared/ui/tokens.css');
    expect(tokens).toContain('"IBM Plex Sans"');
    expect(tokens).toContain('"IBM Plex Mono"');
    expect(readRepoFile('web/src/shared/ui/global.css').split('\n')[0]).toBe(
      "@import './fonts.css';",
    );
  });
});
