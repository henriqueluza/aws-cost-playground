import type { HtmlTagDescriptor, Plugin } from 'vite';

/** Rotas públicas indexáveis. As páginas legais entram aqui quando existirem (#59). */
export const PUBLIC_ROUTES: readonly string[] = ['/'];

/**
 * Origem do site (`VITE_SITE_URL`): https, sem caminho, consulta ou fragmento. Vazia = sem URL
 * absoluta (desenvolvimento e CI). Devolve a origem normalizada, sem barra final.
 */
export function parseSiteUrl(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`VITE_SITE_URL inválida: esperado uma origem https, como https://exemplo.com`);
  }
  if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash || url.username) {
    throw new Error('VITE_SITE_URL inválida: use só a origem https, sem caminho nem credenciais');
  }
  return url.origin;
}

export const robotsTxt = (origin: string | null): string =>
  ['User-agent: *', 'Allow: /', ...(origin ? ['', `Sitemap: ${origin}/sitemap.xml`] : []), ''].join(
    '\n',
  );

export const sitemapXml = (origin: string | null): string => {
  const urls = origin
    ? PUBLIC_ROUTES.map((path) => `  <url><loc>${origin}${path}</loc></url>\n`).join('')
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}</urlset>\n`;
};

/** Canonical e `og:url` (só com origem), mais `robots.txt` e `sitemap.xml` no `dist`. */
export function seo(origin: string | null): Plugin {
  return {
    name: 'seo',
    transformIndexHtml(): HtmlTagDescriptor[] {
      if (!origin) return [];
      const url = `${origin}/`;
      return [
        { tag: 'link', attrs: { rel: 'canonical', href: url }, injectTo: 'head' },
        { tag: 'meta', attrs: { property: 'og:url', content: url }, injectTo: 'head' },
      ];
    },
    generateBundle() {
      if (!origin) this.warn('VITE_SITE_URL ausente: sem canonical, og:url nem URLs no sitemap');
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: robotsTxt(origin) });
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemapXml(origin) });
    },
  };
}
