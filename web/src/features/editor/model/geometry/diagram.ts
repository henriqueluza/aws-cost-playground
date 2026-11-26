import { planEdges, type PlannedEdge, type Size } from './edgeRouting';
import type { Rect } from './fitInsets';

/** Tamanho dos nós (CSS: `--node-width`, três linhas do bloco; o `client` tem uma só). */
export const NODE_SIZE: Readonly<Record<'block' | 'client', Size>> = {
  block: { width: 216, height: 94 },
  client: { width: 216, height: 50 },
};
/** Tamanho da etiqueta de aresta só com o ícone (mono 12px, padding de 2px por 6px, borda). */
export const TAG_SIZE: Size = { width: 28, height: 22 };

export interface PlanNode {
  readonly id: string;
  readonly type?: string;
  readonly position: { readonly x: number; readonly y: number };
}

export interface PlanEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
}

const sizeOf = (node: PlanNode): Size => NODE_SIZE[node.type === 'client' ? 'client' : 'block'];

/**
 * Corredor e etiqueta de cada aresta do diagrama, a partir das posições dos nós. A saída das arestas
 * é o meio da borda direita do nó de origem; a entrada, o meio da borda esquerda do destino.
 */
export function planDiagram(
  nodes: readonly PlanNode[],
  edges: readonly PlanEdge[],
): Map<string, PlannedEdge> {
  const rects = new Map<string, Rect>(
    nodes.map((node) => [node.id, { ...node.position, ...sizeOf(node) }]),
  );
  const ends = edges.flatMap((edge) => {
    const from = rects.get(edge.source);
    const to = rects.get(edge.target);
    if (!from || !to) return [];
    return [
      {
        id: edge.id,
        sx: from.x + from.width,
        sy: from.y + from.height / 2,
        tx: to.x,
        ty: to.y + to.height / 2,
      },
    ];
  });
  return planEdges(ends, [...rects.values()], TAG_SIZE);
}
