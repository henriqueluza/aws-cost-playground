/*
 * SEO por rota numa SPA (script clássico no <head>, como theme.js: a CSP não libera inline).
 * As rotas vêm do bloco JSON #seo-routes, gerado por tooling/seo.ts logo antes deste script.
 * O HTML é o mesmo para toda rota, então canonical e og:url nascem aqui, nunca no HTML.
 * - Pública: canonical e og:url do caminho (só com VITE_SITE_URL no build), mais título e
 *   descrições próprios quando a rota os tem.
 * - Qualquer outra (privada, sem página ou inexistente: o CloudFront devolve este HTML com 200
 *   para todo caminho): <meta name="robots" content="noindex">, sem canonical. Não há Disallow
 *   no robots.txt de propósito: o rastreador precisa abrir a página para ver o noindex.
 * Roda só no carregamento: é o que o rastreador recebe ao abrir cada URL.
 */
(() => {
  'use strict';
  const data = document.getElementById('seo-routes');
  if (!data) return;
  const routes = JSON.parse(data.textContent || '{}');
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  const add = (tag, attrs) => {
    const el = document.createElement(tag);
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
    document.head.appendChild(el);
  };

  if (!(routes.public || []).includes(path)) {
    add('meta', { name: 'robots', content: 'noindex' });
    return;
  }

  const page = Object.hasOwn(routes.pages || {}, path) ? routes.pages[path] : null;
  if (page) {
    const set = (selector, value) =>
      document.querySelector(selector)?.setAttribute('content', value);
    document.title = page.title;
    set('meta[name="description"]', page.description);
    set('meta[property="og:title"]', page.title);
    set('meta[property="og:description"]', page.description);
    set('meta[name="twitter:title"]', page.title);
    set('meta[name="twitter:description"]', page.description);
  }
  if (routes.origin) {
    const url = routes.origin + path;
    add('link', { rel: 'canonical', href: url });
    add('meta', { property: 'og:url', content: url });
  }
})();
