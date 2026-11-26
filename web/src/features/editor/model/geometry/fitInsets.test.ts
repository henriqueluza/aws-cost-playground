import { describe, expect, it } from 'vitest';
import { fitInsets, usableArea, type Rect } from './fitInsets';

const CANVAS = { width: 820, height: 840 };
/** Faixa da legenda no canto inferior esquerdo e controles no canto superior direito. */
const LEGEND: Rect = { x: 8, y: 800, width: 370, height: 34 };
const TOOLS: Rect = { x: 700, y: 8, width: 112, height: 32 };

describe('fitInsets', () => {
  it('sem obstáculos, deixa só a margem em cada lado', () => {
    expect(fitInsets(CANVAS, [], 16)).toEqual({ top: 16, right: 16, bottom: 16, left: 16 });
  });

  it('põe a legenda baixa e larga numa faixa da base, e os controles numa faixa do topo', () => {
    expect(fitInsets(CANVAS, [LEGEND, TOOLS], 16)).toEqual({
      top: 56,
      right: 16,
      bottom: 56,
      left: 16,
    });
  });

  it('corta pelo lado que perde menos área (obstáculo alto e estreito sai pela lateral)', () => {
    const tall: Rect = { x: 8, y: 100, width: 40, height: 700 };
    const insets = fitInsets(CANVAS, [tall], 16);
    expect(insets.left).toBe(64);
    expect(insets.top).toBe(16);
  });

  it('ignora obstáculo que já está fora da área útil', () => {
    const inMargin: Rect = { x: 0, y: 0, width: 10, height: 10 };
    expect(fitInsets(CANVAS, [inMargin], 16)).toEqual({ top: 16, right: 16, bottom: 16, left: 16 });
  });

  it('dá o mesmo resultado em qualquer ordem dos obstáculos', () => {
    expect(fitInsets(CANVAS, [TOOLS, LEGEND], 16)).toEqual(fitInsets(CANVAS, [LEGEND, TOOLS], 16));
  });

  it('a área útil não cruza nenhum obstáculo (com a margem)', () => {
    const area = usableArea(CANVAS, fitInsets(CANVAS, [LEGEND, TOOLS], 16));
    for (const o of [LEGEND, TOOLS]) {
      const apart =
        o.y + o.height + 16 <= area.y ||
        o.y >= area.y + area.height + 16 ||
        o.x + o.width + 16 <= area.x ||
        o.x >= area.x + area.width + 16;
      expect(apart).toBe(true);
    }
  });

  it('usableArea nunca é negativa', () => {
    expect(
      usableArea({ width: 10, height: 10 }, { top: 20, right: 20, bottom: 20, left: 20 }),
    ).toMatchObject({
      width: 0,
      height: 0,
    });
  });
});
