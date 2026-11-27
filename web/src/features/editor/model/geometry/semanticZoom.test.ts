import { describe, expect, it } from 'vitest';
import {
  BODY_PX,
  ENTER_BELOW,
  LEAVE_ABOVE,
  MAX_SCALE,
  TARGET_PX,
  compactScale,
  effectiveBodyPx,
  nameLines,
  nodeDetail,
} from './semanticZoom';

describe('nodeDetail', () => {
  it('abaixo do limiar de entrada é compacto, acima do de saída é completo', () => {
    expect(nodeDetail(0.35, 'full')).toBe('compact');
    expect(nodeDetail(ENTER_BELOW - 0.01, 'full')).toBe('compact');
    expect(nodeDetail(1, 'compact')).toBe('full');
    expect(nodeDetail(LEAVE_ABOVE + 0.01, 'compact')).toBe('full');
  });

  it('entre os limiares mantém o modo anterior (histerese)', () => {
    for (const zoom of [ENTER_BELOW, 0.78, LEAVE_ABOVE]) {
      expect(nodeDetail(zoom, 'full')).toBe('full');
      expect(nodeDetail(zoom, 'compact')).toBe('compact');
    }
  });

  it('subir e descer o zoom em passos não alterna mais de uma vez por travessia', () => {
    const steps = Array.from({ length: 101 }, (_, i) => 0.3 + i * 0.01);
    let detail = nodeDetail(steps[0]!, 'full');
    let flips = 0;
    for (const zoom of steps) {
      const next = nodeDetail(zoom, detail);
      if (next !== detail) flips += 1;
      detail = next;
    }
    for (const zoom of [...steps].reverse()) {
      const next = nodeDetail(zoom, detail);
      if (next !== detail) flips += 1;
      detail = next;
    }
    expect(flips).toBe(2);
  });
});

describe('compactScale', () => {
  it('compensa o zoom para o texto ficar em TARGET_PX na tela', () => {
    for (const zoom of [0.5, 0.6, 0.7]) {
      expect(BODY_PX * compactScale(zoom) * zoom).toBeCloseTo(TARGET_PX, 0);
    }
  });

  it('nunca reduz o texto (mínimo 1) nem passa do teto', () => {
    expect(compactScale(0.9)).toBe(1);
    expect(compactScale(3)).toBe(1);
    expect(compactScale(0.1)).toBe(MAX_SCALE);
    expect(compactScale(0)).toBe(MAX_SCALE);
    expect(compactScale(Number.NaN)).toBe(MAX_SCALE);
  });

  it('é monótona: menos zoom, mais ampliação', () => {
    let last = 0;
    for (let zoom = 1; zoom >= 0.2; zoom -= 0.05) {
      const scale = compactScale(zoom);
      expect(scale).toBeGreaterThanOrEqual(last);
      last = scale;
    }
  });

  it('é determinística', () => {
    expect(compactScale(0.352)).toBe(compactScale(0.352));
  });
});

describe('nameLines', () => {
  it('o nome ocupa duas linhas só enquanto a ampliação deixa o bloco caber', () => {
    expect(nameLines(1)).toBe(2);
    expect(nameLines(1.6)).toBe(2);
    expect(nameLines(1.61)).toBe(1);
    expect(nameLines(MAX_SCALE)).toBe(1);
  });
});

describe('effectiveBodyPx', () => {
  it('no modo compacto o corpo na tela é o alvo, até o teto da ampliação', () => {
    expect(effectiveBodyPx(0.62, 'compact')).toBeCloseTo(TARGET_PX, 1);
    expect(effectiveBodyPx(0.47, 'compact')).toBeCloseTo(TARGET_PX, 1);
    expect(effectiveBodyPx(0.352, 'compact')).toBeCloseTo(BODY_PX * MAX_SCALE * 0.352, 5);
  });

  it('no modo completo é o corpo do canvas vezes o zoom', () => {
    expect(effectiveBodyPx(1, 'full')).toBe(BODY_PX);
    expect(effectiveBodyPx(1.5, 'full')).toBe(BODY_PX * 1.5);
  });
});
