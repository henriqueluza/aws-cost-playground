import { describe, expect, it } from 'vitest';
import {
  corridorLanes,
  planEdges,
  pointAlong,
  routePoints,
  type EdgeEnds,
  type Point,
} from './edgeRouting';
import type { Rect } from './fitInsets';

const TAG = { width: 28, height: 22 };
const edge = (id: string, sy: number, ty: number, sx = 216, tx = 268): EdgeEnds => ({
  id,
  sx,
  sy,
  tx,
  ty,
});
const hit = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const tagRect = (p: Point): Rect => ({
  x: p.x - TAG.width / 2,
  y: p.y - TAG.height / 2,
  width: TAG.width,
  height: TAG.height,
});

describe('corridorLanes', () => {
  it('aresta sozinha fica no meio do corredor', () => {
    expect(corridorLanes([edge('a', 50, 250)]).get('a')).toBe(242);
  });

  it('arestas que dividem corredor e faixa vertical ganham faixas distintas e paralelas', () => {
    const lanes = corridorLanes([edge('a', 50, 250), edge('b', 50, 150), edge('c', 60, 300)]);
    const xs = [...lanes.values()];
    expect(new Set(xs).size).toBe(3);
    expect(Math.min(...xs)).toBeGreaterThan(216);
    expect(Math.max(...xs)).toBeLessThan(268);
    // o destino mais distante vai mais à esquerda
    expect(lanes.get('c')!).toBeLessThan(lanes.get('a')!);
    expect(lanes.get('a')!).toBeLessThan(lanes.get('b')!);
  });

  it('arestas em faixas verticais que não se tocam não se separam', () => {
    const lanes = corridorLanes([edge('a', 0, 100), edge('b', 200, 300)]);
    expect(lanes.get('a')).toBe(lanes.get('b'));
  });

  it('arestas de corredores diferentes não se misturam', () => {
    const lanes = corridorLanes([edge('a', 0, 300), edge('b', 0, 300, 484, 536)]);
    expect(lanes.get('a')).toBe(242);
    expect(lanes.get('b')).toBe(510);
  });

  it('aresta que volta fica fora: traçado padrão', () => {
    expect(corridorLanes([edge('a', 0, 100, 300, 250)]).has('a')).toBe(false);
  });

  it('é determinística e não depende da ordem de entrada', () => {
    const edges = [edge('a', 50, 250), edge('b', 50, 150), edge('c', 60, 300)];
    expect([...corridorLanes(edges)]).toEqual([...corridorLanes(edges)]);
    const reversed = corridorLanes([...edges].reverse());
    for (const [id, x] of corridorLanes(edges)) expect(reversed.get(id)).toBe(x);
  });
});

describe('routePoints e pointAlong', () => {
  it('traça saída, corredor e entrada, sem segmento de comprimento zero', () => {
    expect(routePoints(edge('a', 0, 100), 240)).toEqual([
      { x: 216, y: 0 },
      { x: 240, y: 0 },
      { x: 240, y: 100 },
      { x: 268, y: 100 },
    ]);
    // reta: o ponto do corredor fica na própria linha, e o do degrau (mesmo y) é descartado
    expect(routePoints(edge('b', 40, 40), 240)).toEqual([
      { x: 216, y: 40 },
      { x: 240, y: 40 },
      { x: 268, y: 40 },
    ]);
  });

  it('acha o ponto pelo comprimento da linha', () => {
    const line = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];
    expect(pointAlong(line, 0)).toEqual({ x: 0, y: 0 });
    expect(pointAlong(line, 0.5)).toEqual({ x: 10, y: 0 });
    expect(pointAlong(line, 0.75)).toEqual({ x: 10, y: 5 });
    expect(pointAlong(line, 1)).toEqual({ x: 10, y: 10 });
  });
});

describe('planEdges (etiquetas)', () => {
  // Três arestas no mesmo corredor, com os meios a poucos px um do outro: no meio do traço, empilhariam.
  const edges = [edge('a', 100, 220), edge('b', 100, 232), edge('c', 100, 244)];

  it('nenhum par de etiquetas se toca', () => {
    const plan = planEdges(edges, [], TAG);
    const boxes = edges.map((e) => tagRect(plan.get(e.id)!.label!));
    for (const [i, a] of boxes.entries())
      for (const b of boxes.slice(i + 1)) expect(hit(a, b)).toBe(false);
  });

  it('a etiqueta fica entre 25% e 75% do traço', () => {
    const plan = planEdges(edges, [], TAG);
    for (const e of edges) {
      const route = routePoints(e, plan.get(e.id)!.centerX);
      const label = plan.get(e.id)!.label!;
      const found = Array.from({ length: 101 }, (_, i) => i / 100).some((t) => {
        const p = pointAlong(route, t);
        return (
          t >= 0.25 - 1e-9 && t <= 0.75 + 1e-9 && Math.hypot(p.x - label.x, p.y - label.y) < 0.01
        );
      });
      expect(found).toBe(true);
    }
  });

  it('sem colisão, a etiqueta fica no meio do traço', () => {
    const only = edge('a', 0, 200);
    const plan = planEdges([only], [], TAG);
    expect(plan.get('a')!.label).toEqual(
      pointAlong(routePoints(only, plan.get('a')!.centerX), 0.5),
    );
  });

  it('prefere uma posição que não cubra bloco', () => {
    const only = edge('a', 0, 200);
    const middle = pointAlong(routePoints(only, 242), 0.5);
    const block: Rect = { x: middle.x - 30, y: middle.y - 12, width: 60, height: 24 };
    const label = planEdges([only], [block], TAG).get('a')!.label!;
    expect(hit(tagRect(label), block)).toBe(false);
  });

  it('aresta curta (< 48 px) não ganha etiqueta', () => {
    expect(planEdges([edge('a', 0, 10, 216, 240)], [], TAG).get('a')!.label).toBeUndefined();
  });

  it('a mesma entrada dá o mesmo desenho', () => {
    expect([...planEdges(edges, [], TAG)]).toEqual([...planEdges(edges, [], TAG)]);
  });
});
