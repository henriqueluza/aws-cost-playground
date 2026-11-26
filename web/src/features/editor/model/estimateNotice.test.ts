import { describe, expect, it } from 'vitest';
import { catalogStamp, estimateNoticeText } from './estimateNotice';

const base = 'Estimativa on-demand, não é cotação oficial';
const generatedAt = '2026-11-16T03:00:00Z';

describe('estimateNoticeText', () => {
  it('no idle explica que a data aparece com o primeiro bloco', () => {
    expect(estimateNoticeText({ status: 'idle' })).toBe(
      `${base} · a data dos preços aparece com o primeiro bloco`,
    );
  });

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

describe('catalogStamp', () => {
  it('mapeia idle e loading', () => {
    expect(catalogStamp({ status: 'idle' })).toEqual({ status: 'idle' });
    expect(catalogStamp({ status: 'loading' })).toEqual({ status: 'loading' });
  });

  it('mapeia error para unavailable', () => {
    expect(catalogStamp({ status: 'error' })).toEqual({ status: 'unavailable' });
  });

  it('copia só source e generatedAt no ready', () => {
    expect(catalogStamp({ status: 'ready', source: 'seed', generatedAt })).toEqual({
      status: 'ready',
      source: 'seed',
      generatedAt,
    });
  });

  it('ignora campos extras do estado do catálogo', () => {
    const state = {
      status: 'ready',
      source: 'price-list',
      generatedAt,
      updating: true,
      catalog: { services: new Map() },
    } as const;
    const stamp = catalogStamp(state);
    expect(stamp).toStrictEqual({ status: 'ready', source: 'price-list', generatedAt });
    expect(Object.keys(stamp).sort()).toEqual(['generatedAt', 'source', 'status']);
  });
});
