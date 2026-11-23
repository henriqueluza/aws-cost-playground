import { describe, expect, it } from 'vitest';
import { designCssBlocks, parseCss, readRepoFile } from '../../test/css';

const fromDesign = () => parseCss(designCssBlocks(readRepoFile('DESIGN.md')));
const fromTokens = () => parseCss(readRepoFile('web/src/shared/ui/tokens.css'));

describe('tokens.css', () => {
  it('é idêntico aos blocos css do DESIGN.md, nos dois sentidos', () => {
    expect(
      fromTokens(),
      'tokens.css divergiu do DESIGN.md: ajuste o css ou o documento, nunca só um deles',
    ).toEqual(fromDesign());
  });

  it('declara os contextos claro, escuro e movimento reduzido', () => {
    const contexts = Object.keys(fromTokens());
    expect(contexts).toEqual(
      expect.arrayContaining([
        ':root',
        ":root[data-theme='dark']",
        '@media (prefers-reduced-motion: reduce) :root',
      ]),
    );
  });

  it('o DESIGN.md rende mais de 100 tokens em :root', () => {
    expect(Object.keys(fromDesign()[':root'] ?? {}).length).toBeGreaterThan(100);
  });
});

describe('parseCss como comparador', () => {
  const css = (value: string) => `:root { --a: ${value}; }`;

  it('detecta valor numérico alterado (0.10 contra 0.1)', () => {
    expect(parseCss(css('0.10'))).not.toEqual(parseCss(css('0.1')));
  });

  it('detecta hex diferente', () => {
    expect(parseCss(css('#265496'))).not.toEqual(parseCss(css('#265497')));
  });

  it('ignora só espaços e aspas, não o valor', () => {
    expect(parseCss(css('"x"   y'))).toEqual(parseCss(css("'x' y")));
  });
});
