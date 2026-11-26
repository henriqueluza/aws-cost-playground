/** Retângulo em px (origem no canto superior esquerdo). */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Quanto cada lado da área do canvas fica fora do ajuste. */
export interface Insets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

type Side = keyof Insets;
const SIDES: readonly Side[] = ['top', 'bottom', 'left', 'right'];

/** Área que sobra do canvas depois de descontar os recuos. Nunca negativa. */
export function usableArea(canvas: Size, insets: Insets): Rect {
  return {
    x: insets.left,
    y: insets.top,
    width: Math.max(0, canvas.width - insets.left - insets.right),
    height: Math.max(0, canvas.height - insets.top - insets.bottom),
  };
}

const areaOf = (canvas: Size, insets: Insets): number => {
  const { width, height } = usableArea(canvas, insets);
  return width * height;
};

const intersects = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** Recuo mínimo, de um lado, para o retângulo `r` ficar fora da área útil. */
function insetFor(side: Side, r: Rect, canvas: Size, margin: number): number {
  switch (side) {
    case 'top':
      return r.y + r.height + margin;
    case 'bottom':
      return canvas.height - r.y + margin;
    case 'left':
      return r.x + r.width + margin;
    case 'right':
      return canvas.width - r.x + margin;
  }
}

/**
 * Recuos do ajuste ao diagrama: `margin` em cada lado e, para cada obstáculo (legenda, controles,
 * atribuição) que entre na área útil, a faixa de um lado que o deixa de fora perdendo MENOS área.
 * Os obstáculos vêm em coordenadas do canvas. Função pura e determinística: a ordem de entrada
 * não muda o resultado, e o empate vai para topo, base, esquerda, direita.
 */
export function fitInsets(canvas: Size, obstacles: readonly Rect[], margin: number): Insets {
  let insets: Insets = { top: margin, right: margin, bottom: margin, left: margin };
  const ordered = [...obstacles].sort((a, b) => a.y - b.y || a.x - b.x);
  for (const obstacle of ordered) {
    if (!intersects(obstacle, usableArea(canvas, insets))) continue;
    let best: Insets | null = null;
    for (const side of SIDES) {
      const candidate = {
        ...insets,
        [side]: Math.max(insets[side], insetFor(side, obstacle, canvas, margin)),
      };
      if (best === null || areaOf(canvas, candidate) > areaOf(canvas, best)) best = candidate;
    }
    if (best) insets = best;
  }
  return {
    top: Math.ceil(insets.top),
    right: Math.ceil(insets.right),
    bottom: Math.ceil(insets.bottom),
    left: Math.ceil(insets.left),
  };
}
