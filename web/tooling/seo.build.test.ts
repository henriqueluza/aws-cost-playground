// @vitest-environment node
import { build, type Rollup } from 'vite';
import { afterEach, describe, expect, it } from 'vitest';
import { parseSiteUrl } from './seo.ts';

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
    expect(html).toContain('rel="icon"');
    expect(html).not.toContain('rel="canonical"');
    expect(html).not.toContain('og:url');
    expect(html).not.toMatch(/data:[a-z]+\/[a-z0-9.+-]+[;,]/i);
    expect(html).not.toMatch(/src="https?:/);
    expect(names).toEqual(expect.arrayContaining(['robots.txt', 'sitemap.xml']));
    expect(text('robots.txt')).not.toContain('Sitemap:');
    expect(text('sitemap.xml')).not.toContain('<loc>');
  }, 60_000);

  it('com VITE_SITE_URL: canonical, og:url, sitemap e linha Sitemap', async () => {
    const { text } = await emit('https://exemplo.test/');
    expect(text('index.html')).toContain('<link rel="canonical" href="https://exemplo.test/"');
    expect(text('index.html')).toContain('content="https://exemplo.test/"');
    expect(text('robots.txt')).toContain('Sitemap: https://exemplo.test/sitemap.xml');
    expect(text('sitemap.xml')).toContain('<loc>https://exemplo.test/</loc>');
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
