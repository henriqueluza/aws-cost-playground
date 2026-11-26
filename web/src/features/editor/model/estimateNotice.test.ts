import { describe, expect, it } from 'vitest';
import { estimateNoticeText } from './estimateNotice';

const base = 'Estimativa on-demand, não é cotação oficial';
const generatedAt = '2026-11-16T03:00:00Z';

describe('estimateNoticeText', () => {
  it('mostra a data e a AWS Price List', () => {
    expect(estimateNoticeText({ status: 'ready', source: 'price-list', generatedAt })).toBe(
      `${base} · preços de 2026-11-16 · AWS Price List`,
    );
  });

  it('marca o catálogo de exemplo', () => {
    expect(estimateNoticeText({ status: 'ready', source: 'seed', generatedAt })).toBe(
      `${base} · preços de 2026-11-16 · valores de exemplo`,
    );
  });

  it('avisa enquanto carrega', () => {
    expect(estimateNoticeText({ status: 'loading' })).toBe(
      `${base} · carregando a data dos preços`,
    );
  });

  it('avisa quando a data está indisponível', () => {
    expect(estimateNoticeText({ status: 'unavailable' })).toBe(
      `${base} · data dos preços indisponível`,
    );
  });

  it('trata data fora do formato AAAA-MM-DD como indisponível', () => {
    expect(
      estimateNoticeText({ status: 'ready', source: 'price-list', generatedAt: '<b>x</b>' }),
    ).toBe(`${base} · data dos preços indisponível`);
  });
});
