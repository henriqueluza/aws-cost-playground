// @vitest-environment node
import { build, type Rollup } from 'vite';
import { afterEach, describe, expect, it } from 'vitest';
import { parseSiteUrl, sitemapXml } from './seo.ts';

type Asset = Extract<Rollup.RollupOutput['output'][number], { type: 'asset' }>;

async function emit(siteUrl?: string) {
  if (siteUrl === undefined) delete process.env.VITE_SITE_URL;
  else process.env.VITE_SITE_URL = siteUrl;
  const result = await build({ logLevel: 'silent', build: { write: false } });
  if (Array.isArray(result) || !('output' in result)) throw new Error('saída inesperada');
  const text = (name: string) => {
    const item = result.output.find((o): o is Asset => o.type === 'asset' && o.fileName === name);
    return String(item?.source ?? '');
  };
  return { names: result.output.map((o) => o.fileName), text };
}

afterEach(() => {
  delete process.env.VITE_SITE_URL;
});

describe('SEO no build', () => {
  it('sem VITE_SITE_URL: metadados fixos, sem URL absoluta e sem data:', async () => {
    const { names, text } = await emit();
    const html = text('index.html');
    expect(html).toContain('<html lang="pt-BR">');
    expect(html).toMatch(/<title>AWS Cost Playground[^<]+<\/title>/);
    expect(html).toMatch(/name="description"\s+content="[^"]{50,}"/);
    expect(html).toContain('property="og:title"');
    expect(html).toContain('name="twitter:card"');
    expect(html).toContain('name="viewport"');
    expect(html).toContain('prefers-color-scheme: dark');
    expect(html).toContain('src="/seo.js"');
    expect(html).toContain('"origin":null');
    expect(html).toContain('rel="icon"');
    expect(html).not.toContain('rel="canonical"');
    expect(html).not.toContain('og:url');
    expect(html).not.toMatch(/data:[a-z]+\/[a-z0-9.+-]+[;,]/i);
    expect(html).not.toMatch(/src="https?:/);
    expect(names).toEqual(expect.arrayContaining(['robots.txt', 'sitemap.xml']));
    expect(text('robots.txt')).not.toContain('Sitemap:');
    expect(text('sitemap.xml')).not.toContain('<loc>');
  }, 60_000);

  it('com VITE_SITE_URL: origem no bloco de rotas, sitemap e linha Sitemap', async () => {
    const { text } = await emit('https://exemplo.test/');
    const html = text('index.html');
    // O HTML é o mesmo para toda rota: canonical e og:url só pelo seo.js, com a origem do bloco.
    expect(html).not.toContain('rel="canonical"');
    expect(html).not.toContain('og:url');
    expect(html).toContain('"origin":"https://exemplo.test"');
    // seo.js roda ao ser lido: o bloco de rotas precisa vir antes dele.
    expect(html.indexOf('id="seo-routes"')).toBeGreaterThan(-1);
    expect(html.indexOf('id="seo-routes"')).toBeLessThan(html.indexOf('src="/seo.js"'));
    expect(html.match(/src="\/seo\.js"/g)).toHaveLength(1);
    expect(text('robots.txt')).toContain('Sitemap: https://exemplo.test/sitemap.xml');
    const locs = [...text('sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toEqual([
      'https://exemplo.test/',
      'https://exemplo.test/privacidade',
      'https://exemplo.test/termos',
    ]);
  }, 60_000);
});

describe('parseSiteUrl', () => {
  it('aceita só origem https', () => {
    expect(parseSiteUrl(undefined)).toBeNull();
    expect(parseSiteUrl('  ')).toBeNull();
    expect(parseSiteUrl('https://exemplo.test/')).toBe('https://exemplo.test');
    for (const bad of [
      'http://exemplo.test',
      'exemplo.test',
      'https://exemplo.test/x',
      'https://a@exemplo.test',
      'https://exemplo.test/?q=1',
      'javascript:alert(1)',
    ]) {
      expect(() => parseSiteUrl(bad)).toThrow(/VITE_SITE_URL/);
    }
  });
});

describe('sitemapXml', () => {
  it('escapa & < > no <loc>', () => {
    expect(sitemapXml('https://a&b<c>.test')).toContain(
      '<loc>https://a&amp;b&lt;c&gt;.test/</loc>',
    );
  });
});
