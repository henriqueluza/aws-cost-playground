import { CLIENT_NODE_ID, type DesignDocument } from '../../../shared/lib/design';
import { add, compare, decimal, div, toFixed, type Decimal } from '../../../shared/lib/money';
import type { BlockCost, CostEstimate, CostLine, CostStatus, EdgeCost } from '../model/engine';
import { blockCategory, type BlockCategoryId } from './blockCategory';

const ZERO = decimal(0);

/** Uma linha do painel de custo: um bloco ou uma aresta do design, já com o texto que a nomeia. */
export interface CostRow {
  readonly kind: 'block' | 'edge';
  /** `Block.id` ou `Edge.id`. */
  readonly id: string;
  /** Dado do usuário (rótulo do bloco): só exibir como texto. */
  readonly name: string;
  /** Aresta: o tipo (`data`, `runs-on`, `logs`). Bloco: o tipo sem `aws.`. */
  readonly meta: string;
  readonly category: BlockCategoryId | null;
  readonly status: CostStatus;
  readonly total: Decimal;
  readonly fixed: Decimal;
  readonly variable: Decimal;
  readonly lines: readonly CostLine[];
  /** Largura da barra de proporção, de 0 a 1, relativa ao maior custo da lista. Só desenho. */
  readonly share: number;
}

export interface CostRows {
  readonly blocks: readonly CostRow[];
  readonly edges: readonly CostRow[];
  /** Itens `unavailable` (blocos e arestas): ficam fora do total. */
  readonly unavailable: number;
}

type Item = Pick<BlockCost, 'status' | 'total' | 'fixed' | 'variable' | 'lines'>;

/** Preço > 0 primeiro (maior custo antes), depois custo zero, depois sem preço; empate: ordem do design. */
function rank(row: Pick<CostRow, 'status' | 'total'>): number {
  if (row.status === 'unavailable') return 2;
  return compare(row.total, ZERO) > 0 ? 0 : 1;
}

export function sortRows(rows: readonly CostRow[]): CostRow[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort(
      (a, b) => rank(a.row) - rank(b.row) || compare(b.row.total, a.row.total) || a.index - b.index,
    )
    .map(({ row }) => row);
}

/** Proporção do maior custo, para a largura da barra de 2px. Desenho apenas: nada é somado com ela. */
function withShares(rows: readonly CostRow[]): CostRow[] {
  const max = rows.reduce((top, row) => (compare(row.total, top) > 0 ? row.total : top), ZERO);
  return rows.map((row) => ({
    ...row,
    share: compare(max, ZERO) === 0 ? 0 : Number(toFixed(div(row.total, max), 4)),
  }));
}

const row = (
  base: Pick<CostRow, 'kind' | 'id' | 'name' | 'meta' | 'category'>,
  item: Item,
): CostRow => ({
  ...base,
  status: item.status,
  total: item.total,
  fixed: item.fixed,
  variable: item.variable,
  lines: item.lines,
  share: 0,
});

/** Nome de uma ponta de aresta: rótulo do bloco, `Internet` para o nó fixo, o id se o bloco sumiu. */
const nodeName = (labels: ReadonlyMap<string, string>, id: string): string =>
  id === CLIENT_NODE_ID ? 'Internet' : (labels.get(id) ?? id);

/**
 * Linhas do painel a partir do design e do resultado do motor. Pura: não calcula custo, só ordena
 * (por `compare`), nomeia e prepara a barra. O motor já deixou o `unavailable` fora dos totais.
 */
export function buildCostRows(design: DesignDocument, estimate: CostEstimate): CostRows {
  const labels = new Map(design.blocks.map((b) => [b.id, b.label.trim() || b.type] as const));
  const blocks = estimate.blocks.map((cost) =>
    row(
      {
        kind: 'block',
        id: cost.blockId,
        name: labels.get(cost.blockId) ?? cost.blockType,
        meta: cost.blockType.replace(/^aws\./, ''),
        category: blockCategory(cost.blockType),
      },
      cost,
    ),
  );
  const edgeById = new Map(design.edges.map((e) => [e.id, e] as const));
  const edges = estimate.edges.map((cost: EdgeCost) => {
    const edge = edgeById.get(cost.edgeId);
    const name = edge
      ? `${nodeName(labels, edge.source)} → ${nodeName(labels, edge.target)}`
      : cost.edgeId;
    return row({ kind: 'edge', id: cost.edgeId, name, meta: cost.kind, category: null }, cost);
  });
  return {
    blocks: withShares(sortRows(blocks)),
    edges: withShares(sortRows(edges)),
    unavailable: [...blocks, ...edges].filter((r) => r.status === 'unavailable').length,
  };
}

/** Parte fixa do total, de 0 a 1, para a barra fixo/variável. Desenho apenas. */
export function fixedShare(fixed: Decimal, variable: Decimal): number {
  const total = add(fixed, variable);
  return compare(total, ZERO) === 0 ? 0 : Number(toFixed(div(fixed, total), 4));
}
