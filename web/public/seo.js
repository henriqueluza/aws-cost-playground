/*
 * SEO por rota numa SPA (script clássico no <head>, como theme.js: a CSP não libera inline).
 * Rotas privadas ganham <meta name="robots" content="noindex"> e perdem o canonical; nas demais,
 * o canonical e o og:url seguem o caminho atual (só se o build os emitiu, ou seja, com
 * VITE_SITE_URL). Não há robots.txt Disallow nessas rotas de propósito: o rastreador precisa
 * abrir a página para ver o noindex.
 */
(() => {
  'use strict';
  const PRIVATE = ['/designs', '/conta', '/auth/callback'];
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  if (PRIVATE.some((p) => path === p || path.startsWith(`${p}/`))) {
    const robots = document.createElement('meta');
    robots.name = 'robots';
    robots.content = 'noindex';
    document.head.appendChild(robots);
    document.querySelector('link[rel="canonical"]')?.remove();
    document.querySelector('meta[property="og:url"]')?.remove();
    return;
  }
  const canonical = document.querySelector('link[rel="canonical"]');
  if (!canonical) return;
  const url = new URL(canonical.href).origin + (path === '/' ? '/' : path);
  canonical.href = url;
  document.querySelector('meta[property="og:url"]')?.setAttribute('content', url);
})();
