import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

const code = readFileSync(resolve(process.cwd(), 'public/seo.js'), 'utf8');

function run(path: string, withCanonical = true) {
  window.history.pushState({}, '', path);
  document.head.innerHTML = withCanonical
    ? '<link rel="canonical" href="https://exemplo.test/"><meta property="og:url" content="https://exemplo.test/">'
    : '';
  new Function(code)();
  return {
    robots: document.querySelector('meta[name="robots"]')?.getAttribute('content'),
    canonical: document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href,
    ogUrl: document.querySelector('meta[property="og:url"]')?.getAttribute('content'),
  };
}

describe('public/seo.js', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
  });

  it.each(['/designs', '/designs/abc', '/conta', '/auth/callback'])('%s recebe noindex', (path) => {
    expect(run(path)).toEqual({ robots: 'noindex', canonical: undefined, ogUrl: undefined });
  });

  it('rota pública segue o caminho no canonical e no og:url', () => {
    expect(run('/')).toMatchObject({ robots: undefined, canonical: 'https://exemplo.test/' });
    expect(run('/privacidade/')).toMatchObject({
      canonical: 'https://exemplo.test/privacidade',
      ogUrl: 'https://exemplo.test/privacidade',
    });
  });

  it('não indexa por engano rota parecida e não cria canonical sem build com URL', () => {
    expect(run('/designs-publicos').robots).toBeUndefined();
    expect(run('/', false).canonical).toBeUndefined();
  });
});
