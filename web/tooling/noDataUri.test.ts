import { describe, expect, it } from 'vitest';
import { findDataUri, noDataUri } from './noDataUri.ts';

describe('findDataUri', () => {
  it.each([
    'url(data:font/woff2;base64,AAAA)',
    'src="data:image/svg+xml,%3Csvg"',
    'x = "DATA:Text/HTML;charset=utf-8,<p>"',
  ])('acha URI data: em %s', (text) => {
    expect(findDataUri(text)).not.toBeNull();
  });

  it.each(['{data:1,other:2}', 'const data: Row[] = []', 'a data:b', 'metadata:x/y'])(
    'ignora %s',
    (text) => {
      expect(findDataUri(text)).toBeNull();
    },
  );
});

type Hook = (this: { error: (m: string) => never }, o: unknown, b: Record<string, unknown>) => void;
const run = (bundle: Record<string, unknown>) => {
  const hook = (noDataUri() as unknown as { generateBundle: Hook }).generateBundle;
  hook.call(
    {
      error: (m) => {
        throw new Error(m);
      },
    },
    {},
    bundle,
  );
};

describe('noDataUri (plugin)', () => {
  it('passa com bundle limpo e ignora asset binário', () => {
    expect(() =>
      run({
        'a.js': { type: 'chunk', code: 'const o={data:1}' },
        'f.woff2': { type: 'asset', source: new Uint8Array([100, 97, 116, 97, 58]) },
      }),
    ).not.toThrow();
  });

  it('falha o build com URI data: em chunk', () => {
    expect(() => run({ 'a.js': { type: 'chunk', code: 'x="data:image/png;base64,AA"' } })).toThrow(
      /a\.js/,
    );
  });

  it('falha o build com URI data: em asset de texto (CSS)', () => {
    expect(() =>
      run({ 'a.css': { type: 'asset', source: 'a{src:url(data:font/woff2;base64,AA)}' } }),
    ).toThrow(/a\.css/);
  });
});
