import { describe, expect, it } from 'vitest';
import { designDocumentSchema } from '../../../../shared/lib/design';
import { defaultLayout } from '../canvasModel';
import { referenceDesign, referenceLayout } from '../template/referenceTemplate';
import { NODE_SIZE, TAG_SIZE, planDiagram } from './diagram';
import type { Rect } from './fitInsets';
import scenarioApp from '../../../../../../contracts/scenarios/app-classico.json';
import scenarioPipeline from '../../../../../../contracts/scenarios/pipeline-de-filas.json';
import scenarioApi from '../../../../../../contracts/scenarios/api-serverless.json';

const hit = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

const cases = [
  ['template', referenceDesign(), referenceLayout()],
  ...[scenarioApi, scenarioApp, scenarioPipeline].map((raw) => {
    const doc = designDocumentSchema.parse(raw);
    return ['cenário', doc, defaultLayout(doc)] as const;
  }),
] as const;

describe.each(cases)('planDiagram do %s', (_name, doc, layout) => {
  const nodes = Object.entries(layout).map(([id, position]) => ({
    id,
    type: id === 'client' ? 'client' : 'block',
    position,
  }));
  const edges = doc.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
  }));
  const plan = planDiagram(nodes, edges);

  it('nenhum par de etiquetas se sobrepõe', () => {
    const boxes = [...plan.values()].flatMap((p) =>
      p.label
        ? [
            {
              x: p.label.x - TAG_SIZE.width / 2,
              y: p.label.y - TAG_SIZE.height / 2,
              width: TAG_SIZE.width,
              height: TAG_SIZE.height,
            },
          ]
        : [],
    );
    for (const [i, a] of boxes.entries())
      for (const b of boxes.slice(i + 1)) expect(hit(a, b)).toBe(false);
  });

  it('nenhum par de arestas com o mesmo corredor e a mesma faixa vertical', () => {
    const at = (id: string) => nodes.find((n) => n.id === id)!;
    const spans = edges.flatMap((edge) => {
      const x = plan.get(edge.id)?.centerX;
      if (x === undefined) return [];
      const from = at(edge.source).position.y + NODE_SIZE.block.height / 2;
      const to = at(edge.target).position.y + NODE_SIZE.block.height / 2;
      return [{ id: edge.id, x, lo: Math.min(from, to), hi: Math.max(from, to) }];
    });
    const shared = spans.flatMap((a, i) =>
      spans
        .slice(i + 1)
        .filter((b) => Math.abs(a.x - b.x) < 2 && a.lo < b.hi && b.lo < a.hi)
        .map((b) => `${a.id} x ${b.id}`),
    );
    // Só o `client` tem altura diferente (50): o centro das duas pontas é aproximado, daí a margem de 2 px.
    expect(shared).toEqual([]);
  });
});
