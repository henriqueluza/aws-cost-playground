import type { HtmlTagDescriptor, Plugin } from 'vite';

export interface PageMeta {
  readonly title: string;
  readonly description: string;
}

/**
 * Título e descrição das rotas públicas além da inicial (`/` usa os do `index.html`). Fonte
 * única: o sitemap sai daqui e `public/seo.js` aplica esses valores no carregamento da página.
 */
export const PAGE_META: Readonly<Record<string, PageMeta>> = {
  '/privacidade': {
    title: 'Política de privacidade | AWS Cost Playground',
    description:
      'Política de privacidade do AWS Cost Playground: quais dados pessoais são tratados, com que finalidade, por quanto tempo e como exercer seus direitos pela LGPD.',
  },
  '/termos': {
    title: 'Termos de uso | AWS Cost Playground',
    description:
      'Termos de uso do AWS Cost Playground: condições para usar o serviço, limites das estimativas de custo e responsabilidades de cada parte.',
  },
};

/** Rotas indexáveis: entram no sitemap e ganham canonical e `og:url` (com `VITE_SITE_URL`). */
export const PUBLIC_ROUTES: readonly string[] = ['/', ...Object.keys(PAGE_META)];

/** Rotas privadas: `noindex` e sem canonical (a rota e tudo abaixo dela). */
export const NOINDEX_ROUTES: readonly string[] = ['/designs', '/conta', '/auth/callback'];

/** Id do bloco JSON (não executável, fora do alcance da CSP) que `public/seo.js` lê. */
export const ROUTES_ELEMENT_ID = 'seo-routes';

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

const XML_ESCAPES: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
const escapeXml = (text: string): string => text.replace(/[&<>]/g, (c) => XML_ESCAPES[c] ?? c);

export const robotsTxt = (origin: string | null): string =>
  ['User-agent: *', 'Allow: /', ...(origin ? ['', `Sitemap: ${origin}/sitemap.xml`] : []), ''].join(
    '\n',
  );

export const sitemapXml = (origin: string | null): string => {
  const urls = origin
    ? PUBLIC_ROUTES.map((path) => `  <url><loc>${escapeXml(origin + path)}</loc></url>\n`).join('')
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}</urlset>\n`;
};

/**
 * Tags do fim do `<head>`: o bloco JSON das rotas e, depois dele, `seo.js`, que roda ao ser lido.
 * Canonical e `og:url` não vão no HTML: ele é o mesmo para toda rota da SPA, então `seo.js` os
 * cria só nas rotas públicas, com a origem do bloco.
 */
export function seoTags(origin: string | null): HtmlTagDescriptor[] {
  const routes = { origin, public: PUBLIC_ROUTES, noindex: NOINDEX_ROUTES, pages: PAGE_META };
  return [
    {
      tag: 'script',
      attrs: { type: 'application/json', id: ROUTES_ELEMENT_ID },
      // `<` escapado: nenhum valor fecha o </script> antes da hora.
      children: JSON.stringify(routes).replace(/</g, '\\u003c'),
      injectTo: 'head',
    },
    { tag: 'script', attrs: { src: '/seo.js' }, injectTo: 'head' },
  ];
}

/** Tags de SEO no `index.html`, mais `robots.txt` e `sitemap.xml` no `dist`. */
export function seo(origin: string | null): Plugin {
  return {
    name: 'seo',
    transformIndexHtml: () => seoTags(origin),
    generateBundle() {
      if (!origin) this.warn('VITE_SITE_URL ausente: sem canonical, og:url nem URLs no sitemap');
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: robotsTxt(origin) });
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemapXml(origin) });
    },
  };
}
