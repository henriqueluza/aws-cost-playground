import { describe, expect, it } from 'vitest';
import { parseCss, readRepoFile } from '../../test/css';

const base = () => parseCss(readRepoFile('web/src/shared/ui/base.css'));
const tokens = () => parseCss(readRepoFile('web/src/shared/ui/tokens.css'));

describe('base.css', () => {
  it('body usa os tokens de fonte, texto e fundo e zera a margem', () => {
    expect(base()['body']).toMatchObject({
      'font-family': 'var(--font)',
      'font-size': 'var(--fs-body)',
      'line-height': 'var(--lh-body)',
      color: 'var(--text)',
      'background-color': 'var(--ground)',
      margin: '0',
    });
  });

  it(':focus-visible desenha o anel pelos tokens de foco', () => {
    expect(base()[':focus-visible']).toMatchObject({
      outline: 'var(--focus-width) solid var(--focus)',
      'outline-offset': 'var(--focus-offset)',
    });
  });

  it.each(['body', ':focus-visible'])('%s não tem hex nem px literal', (context) => {
    const values = Object.values(base()[context] ?? {});
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) expect(value).not.toMatch(/#|\d\s*px\b/);
  });

  it('todo var(--x) usado está definido em :root dos tokens', () => {
    const defined = new Set(Object.keys(tokens()[':root'] ?? {}));
    const css = readRepoFile('web/src/shared/ui/base.css');
    const used = [...css.matchAll(/var\((--[\w-]+)/g)].flatMap((m) => (m[1] ? [m[1]] : []));
    expect(used.length).toBeGreaterThan(0);
    expect(used.filter((name) => !defined.has(name))).toEqual([]);
  });
});
