import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { HtmlTagDescriptor } from 'vite';
import { describe, expect, it } from 'vitest';
import { PAGE_META, PUBLIC_ROUTES, seoTags } from './seo.ts';

const code = readFileSync(resolve(process.cwd(), 'public/seo.js'), 'utf8');
const indexHead = new DOMParser().parseFromString(
  readFileSync(resolve(process.cwd(), 'index.html'), 'utf8'),
  'text/html',
).head;
const HOME_TITLE = indexHead.querySelector('title')?.textContent ?? '';

function element({ tag, attrs = {}, children }: HtmlTagDescriptor): HTMLElement {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, String(value));
  if (typeof children === 'string') el.textContent = children;
  return el;
}

/** Monta o `<head>` do build (index.html + tags do plugin, na ordem) e roda `seo.js`. */
function run(path: string, { origin = 'https://exemplo.test' as string | null, tags = true } = {}) {
  window.history.pushState({}, '', path);
  const plugin = tags ? seoTags(origin).filter((t) => !t.attrs?.src) : [];
  document.head.replaceChildren(
    ...[...indexHead.children]
      .filter((el) => el.tagName !== 'SCRIPT')
      .map((el) => el.cloneNode(true)),
    ...plugin.map(element),
  );
  new Function(code)();
  const content = (selector: string) => document.querySelector(selector)?.getAttribute('content');
  return {
    title: document.title,
    description: content('meta[name="description"]'),
    ogTitle: content('meta[property="og:title"]'),
    ogDescription: content('meta[property="og:description"]'),
    twitterTitle: content('meta[name="twitter:title"]'),
    twitterDescription: content('meta[name="twitter:description"]'),
    robots: content('meta[name="robots"]'),
    canonical: document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href,
    links: document.querySelectorAll('link[rel="canonical"], meta[property="og:url"]').length,
    ogUrl: content('meta[property="og:url"]'),
  };
}

describe('public/seo.js', () => {
  it('as páginas legais são rotas públicas', () => {
    expect(PUBLIC_ROUTES).toEqual(['/', '/privacidade', '/termos']);
  });

  it.each(['/designs', '/designs/abc', '/conta', '/conta/', '/auth/callback'])(
    '%s recebe noindex, sem canonical nem og:url',
    (path) => {
      expect(run(path)).toMatchObject({
        robots: 'noindex',
        canonical: undefined,
        ogUrl: undefined,
      });
    },
  );

  it('/ mantém os metadados do index.html, com canonical e og:url próprios', () => {
    expect(run('/')).toMatchObject({
      title: HOME_TITLE,
      ogTitle: HOME_TITLE,
      robots: undefined,
      canonical: 'https://exemplo.test/',
      ogUrl: 'https://exemplo.test/',
    });
  });

  it.each(['/privacidade', '/termos'])(
    '%s tem título, descrição, Open Graph e canonical próprios',
    (path) => {
      const { title, description } = PAGE_META[path] ?? { title: '', description: '' };
      const url = `https://exemplo.test${path}`;
      expect(title).not.toBe(HOME_TITLE);
      expect(description.length).toBeGreaterThanOrEqual(50);
      const expected = {
        title,
        description,
        ogTitle: title,
        ogDescription: description,
        twitterTitle: title,
        twitterDescription: description,
        robots: undefined,
        canonical: url,
        ogUrl: url,
        links: 2,
      };
      expect(run(path)).toEqual(expected);
      expect(run(`${path}/`)).toEqual(expected);
    },
  );

  it.each(['/comparar', '/designs-publicos', '/qualquer', '/Privacidade', '/index.html'])(
    '%s (fora das públicas) recebe noindex, sem canonical nem og:url',
    (path) => {
      expect(run(path)).toMatchObject({
        title: HOME_TITLE,
        robots: 'noindex',
        canonical: undefined,
        ogUrl: undefined,
      });
    },
  );

  it('sem VITE_SITE_URL: título próprio e noindex continuam, sem canonical', () => {
    expect(run('/termos', { origin: null })).toMatchObject({
      title: PAGE_META['/termos']?.title,
      canonical: undefined,
    });
    expect(run('/conta', { origin: null }).robots).toBe('noindex');
  });

  it('sem o bloco de rotas não altera a página', () => {
    expect(run('/termos', { tags: false })).toMatchObject({ title: HOME_TITLE, robots: undefined });
  });
});
