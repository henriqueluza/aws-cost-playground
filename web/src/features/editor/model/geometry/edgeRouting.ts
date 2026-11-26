import type { Rect } from './fitInsets';

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** As pontas de uma aresta, em coordenadas do fluxo: saída (direita) e entrada (esquerda). */
export interface EdgeEnds {
  readonly id: string;
  readonly sx: number;
  readonly sy: number;
  readonly tx: number;
  readonly ty: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

/** Abaixo disto (px entre as pontas) a etiqueta não cabe; vale a regra de 48 px do DESIGN.md. */
export const MIN_TAG_LENGTH = 48;
/** Aresta que não anda mais que isto para a direita não ganha corredor próprio. */
const MIN_FORWARD = 24;
/** Meia largura máxima do corredor a partir da saída, e folga entre a faixa e o bloco. */
const MAX_HALF_GAP = 26;
const CLEARANCE = 6;
const MAX_SPACING = 9;
/** Posições de teste da etiqueta, do meio para fora, dentro de 25% a 75% do traço. */
const SLIDES = [0.5, 0.45, 0.55, 0.4, 0.6, 0.35, 0.65, 0.3, 0.7, 0.25, 0.75] as const;
const TAG_GAP = 4;

const isForward = (e: EdgeEnds): boolean => e.tx - e.sx >= MIN_FORWARD;
const halfGap = (e: EdgeEnds): number => Math.min((e.tx - e.sx) / 2, MAX_HALF_GAP);
const span = (e: EdgeEnds): readonly [number, number] => [
  Math.min(e.sy, e.ty),
  Math.max(e.sy, e.ty),
];
const overlaps = (a: EdgeEnds, b: EdgeEnds): boolean => {
  const [a0, a1] = span(a);
  const [b0, b1] = span(b);
  return a0 < b1 && b0 < a1;
};

/**
 * Corredor (x do trecho vertical) de cada aresta que anda para a direita. Arestas que dividiriam o
 * mesmo corredor e a mesma faixa vertical ficam em faixas paralelas, lado a lado: a de destino mais
 * distante vai mais à esquerda, para o último trecho horizontal de uma não cortar o vertical da outra.
 * Arestas que voltam (ou quase retas na horizontal) ficam de fora: o traçado padrão serve.
 */
export function corridorLanes(edges: readonly EdgeEnds[]): Map<string, number> {
  const forward = edges.filter(isForward);
  const base = (e: EdgeEnds): number => e.sx + halfGap(e);
  const parent = forward.map((_, i) => i);
  const root = (i: number): number => {
    let r = i;
    while (parent[r] !== r) r = parent[r]!;
    return r;
  };
  forward.forEach((a, i) =>
    forward.slice(i + 1).forEach((b, k) => {
      if (Math.abs(base(a) - base(b)) < 1 && overlaps(a, b)) parent[root(i + 1 + k)] = root(i);
    }),
  );
  const clusters = new Map<number, EdgeEnds[]>();
  forward.forEach((e, i) => clusters.set(root(i), [...(clusters.get(root(i)) ?? []), e]));

  const lanes = new Map<string, number>();
  for (const members of clusters.values()) {
    const ordered = [...members].sort(
      (a, b) => Math.abs(b.ty - b.sy) - Math.abs(a.ty - a.sy) || a.id.localeCompare(b.id),
    );
    const n = ordered.length;
    const half = Math.max(0, Math.min(...ordered.map(halfGap)) - CLEARANCE);
    const spacing = n > 1 ? Math.min(MAX_SPACING, (2 * half) / (n - 1)) : 0;
    ordered.forEach((e, k) => lanes.set(e.id, base(e) + (k - (n - 1) / 2) * spacing));
  }
  return lanes;
}

/** Vértices do traço ortogonal `saída → corredor → entrada`, sem segmentos de comprimento zero. */
export function routePoints(e: EdgeEnds, centerX: number = (e.sx + e.tx) / 2): Point[] {
  const raw: Point[] = [
    { x: e.sx, y: e.sy },
    { x: centerX, y: e.sy },
    { x: centerX, y: e.ty },
    { x: e.tx, y: e.ty },
  ];
  return raw.filter((p, i) => i === 0 || p.x !== raw[i - 1]!.x || p.y !== raw[i - 1]!.y);
}

/** Ponto a `t` (0 a 1) do comprimento da linha quebrada. */
export function pointAlong(points: readonly Point[], t: number): Point {
  const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i]!.x, p.y - points[i]!.y));
  const total = lengths.reduce((sum, l) => sum + l, 0);
  let left = t * total;
  for (const [i, length] of lengths.entries()) {
    const from = points[i]!;
    const to = points[i + 1]!;
    if (left <= length || i === lengths.length - 1) {
      const f = length === 0 ? 0 : Math.min(1, left / length);
      return { x: from.x + (to.x - from.x) * f, y: from.y + (to.y - from.y) * f };
    }
    left -= length;
  }
  return points[0] ?? { x: 0, y: 0 };
}

const around = (p: Point, size: Size, grow = 0): Rect => ({
  x: p.x - size.width / 2 - grow,
  y: p.y - size.height / 2 - grow,
  width: size.width + 2 * grow,
  height: size.height + 2 * grow,
});
const hit = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** Ordem lexicográfica: a primeira diferença decide. */
const lessThan = (a: readonly number[], b: readonly number[]): boolean => {
  const k = a.findIndex((v, i) => v !== b[i]);
  return k >= 0 && a[k]! < b[k]!;
};

/** O segmento (horizontal ou vertical) de `a` a `b` atravessa o retângulo? */
const crosses = (a: Point, b: Point, r: Rect): boolean =>
  Math.max(a.x, b.x) > r.x &&
  Math.min(a.x, b.x) < r.x + r.width &&
  Math.max(a.y, b.y) > r.y &&
  Math.min(a.y, b.y) < r.y + r.height;

export interface PlannedEdge {
  /** `x` do trecho vertical; ausente na aresta que volta (traçado padrão). */
  readonly centerX?: number;
  /** Centro da etiqueta, ou ausente se a aresta é curta demais para ela. */
  readonly label?: Point;
}

/**
 * O desenho de todas as arestas: corredor de cada uma e posição da etiqueta ao longo do traço.
 * A etiqueta começa a meio caminho e desliza entre 25% e 75% (DESIGN.md) até não tocar outra etiqueta
 * nem um bloco; se nenhuma posição serve, vale a que toca menos etiquetas. As arestas entram na
 * ordem recebida, então o resultado é o mesmo para a mesma entrada.
 */
export function planEdges(
  edges: readonly EdgeEnds[],
  nodes: readonly Rect[],
  tag: Size,
): Map<string, PlannedEdge> {
  const lanes = corridorLanes(edges);
  const routes = new Map(edges.map((e) => [e.id, routePoints(e, lanes.get(e.id))]));
  /** Quantos traços de OUTRAS arestas passam por baixo da etiqueta: ela pareceria delas também. */
  const strokesUnder = (box: Rect, own: string): number =>
    [...routes].filter(
      ([id, pts]) => id !== own && pts.slice(1).some((p, i) => crosses(pts[i]!, p, box)),
    ).length;
  const placed: Rect[] = [];
  const plan = new Map<string, PlannedEdge>();
  for (const e of edges) {
    const centerX = lanes.get(e.id);
    const route = routes.get(e.id) ?? routePoints(e, centerX);
    if (Math.hypot(e.tx - e.sx, e.ty - e.sy) < MIN_TAG_LENGTH) {
      plan.set(e.id, centerX === undefined ? {} : { centerX });
      continue;
    }
    let best: { point: Point; score: readonly [number, number, number] } | null = null;
    for (const t of SLIDES) {
      const point = pointAlong(route, t);
      const box = around(point, tag);
      const score = [
        placed.filter((other) => hit(box, other)).length,
        nodes.filter((node) => hit(box, node)).length,
        strokesUnder(box, e.id),
      ] as const;
      // etiquetas, depois blocos, depois traços alheios: a ordem de importância
      if (best === null || lessThan(score, best.score)) best = { point, score };
      if (score.every((v) => v === 0)) break;
    }
    const label = best?.point ?? pointAlong(route, 0.5);
    placed.push(around(label, tag, TAG_GAP / 2));
    plan.set(e.id, centerX === undefined ? { label } : { centerX, label });
  }
  return plan;
}
