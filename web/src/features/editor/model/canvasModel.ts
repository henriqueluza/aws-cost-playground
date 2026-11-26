import { CLIENT_NODE_ID, type DesignDocument, type EdgeKind } from '../../../shared/lib/design';
import { toFixed, type Money } from '../../../shared/lib/money';
import { blockDefinition, type BlockCategory } from '../../pricing';
import type { Layout, Selection } from './editorState';

/** As cinco categorias do desenho (DESIGN.md, "Categorias dos blocos"). */
export type CanvasCategory = 'compute' | 'data' | 'network' | 'security' | 'ops';

export const CATEGORY_LABELS: Record<CanvasCategory, string> = {
  compute: 'Computação',
  data: 'Dados',
  network: 'Rede',
  security: 'Segurança',
  ops: 'Operação',
};

const CATEGORY_OF: Record<BlockCategory, CanvasCategory> = {
  compute: 'compute',
  storage: 'data',
  database: 'data',
  integration: 'data',
  networking: 'network',
  security: 'security',
  management: 'ops',
  devtools: 'ops',
};

/** Categoria do desenho de um tipo de bloco; `null` se o tipo não está no contrato. */
export function canvasCategory(type: string): CanvasCategory | null {
  const definition = blockDefinition(type);
  return definition ? CATEGORY_OF[definition.category] : null;
}

/** Custo mensal pronto para exibir. `zero` vira texto em `--muted`. */
export type CostView = { readonly text: string; readonly zero: boolean };
const NO_COST = '—';

/** `1234.5` em Money vira `US$ 1.234,50`. Só a borda de exibição vê o texto. */
export function formatUsd(value: Money): string {
  const [integer = '0', fraction = '00'] = toFixed(value, 2).split('.');
  return `US$ ${integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${fraction}`;
}

export type BlockNodeData = {
  readonly kind: 'block';
  readonly label: string;
  readonly service: string;
  readonly category: CanvasCategory | null;
  readonly summary: string;
  readonly cost: string;
  readonly costZero: boolean;
  readonly costNote: string | null;
};
export type ClientNodeData = { readonly kind: 'client'; readonly label: string };

/** Forma do nó do React Flow, sem importá-lo: o model é TypeScript puro. */
export type CanvasNode = {
  readonly id: string;
  readonly type: 'block' | 'client';
  readonly position: { readonly x: number; readonly y: number };
  readonly selected: boolean;
  readonly selectable: boolean;
  readonly deletable: boolean;
  readonly ariaLabel: string;
  readonly data: BlockNodeData | ClientNodeData;
};
export type CanvasEdge = {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly selected: boolean;
  readonly ariaLabel: string;
  readonly data: { readonly kind: EdgeKind };
};

const CELL = { x: 248, y: 144 };

/**
 * Posição de quem não tem entrada no layout: uma coluna por profundidade (o maior caminho desde
 * um bloco sem entrada) e o `client` na última coluna, para o desenho ler da esquerda para a direita.
 */
export function defaultLayout(doc: DesignDocument): Record<string, { x: number; y: number }> {
  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  // Aresta que fecha um ciclo é ignorada: o bloco já está na pilha.
  const depthOf = (id: string): number => {
    const known = depth.get(id);
    if (known !== undefined) return known;
    visiting.add(id);
    const sources = doc.edges.filter((edge) => edge.target === id && !visiting.has(edge.source));
    const value = Math.max(-1, ...sources.map((edge) => depthOf(edge.source))) + 1;
    visiting.delete(id);
    depth.set(id, value);
    return value;
  };
  const rows = new Map<number, number>();
  const place = (id: string, column: number) => {
    const row = rows.get(column) ?? 0;
    rows.set(column, row + 1);
    return [id, { x: CELL.x * column, y: CELL.y * row }] as const;
  };
  const blocks = doc.blocks.map((block) => place(block.id, depthOf(block.id)));
  return Object.fromEntries([
    ...blocks,
    place(CLIENT_NODE_ID, Math.max(0, ...doc.blocks.map((block) => depthOf(block.id))) + 1),
  ]);
}

const KIND_LABELS: Record<EdgeKind, string> = {
  data: 'Dados',
  'runs-on': 'Executa em',
  logs: 'Logs',
};

/** Resumo do SKU: os atributos do contrato, na ordem dele (`arm64 · 512`). */
function skuSummary(block: DesignDocument['blocks'][number]): string {
  const attributes = blockDefinition(block.type)?.attributes ?? [];
  return attributes
    .map((attribute) => block.attributes[attribute.key])
    .filter((value) => value !== undefined)
    .map(String)
    .join(' · ');
}

const serviceName = (type: string): string => blockDefinition(type)?.name ?? 'Bloco';

/** Nós do canvas derivados do design, do layout e da seleção. Função pura. */
export function toCanvasNodes(
  doc: DesignDocument,
  layout: Layout,
  selection: Selection,
  costs: ReadonlyMap<string, CostView>,
): CanvasNode[] {
  const fallback = defaultLayout(doc);
  const client: CanvasNode = {
    id: CLIENT_NODE_ID,
    type: 'client',
    position: layout[CLIENT_NODE_ID] ?? fallback[CLIENT_NODE_ID]!,
    selected: false,
    selectable: false,
    deletable: false,
    ariaLabel: 'Internet. Destino fixo do tráfego para fora da AWS.',
    data: { kind: 'client', label: 'Internet' },
  };
  const blocks = doc.blocks.map((block): CanvasNode => {
    const service = serviceName(block.type);
    const category = canvasCategory(block.type);
    const cost = costs.get(block.id);
    const label = block.label.trim() === '' ? service : block.label;
    const costNote = block.type === 'aws.ecs' ? 'custo no EC2' : null;
    const costText = cost?.text ?? NO_COST;
    const costSpoken = cost ? `${costText} por mês` : 'custo ainda sem valor';
    const categoryName = category ? CATEGORY_LABELS[category] : 'sem categoria';
    return {
      id: block.id,
      type: 'block',
      position: layout[block.id] ?? fallback[block.id]!,
      selected: selection?.kind === 'block' && selection.id === block.id,
      selectable: true,
      deletable: true,
      ariaLabel: `${service}, ${label}, ${categoryName}, ${costSpoken}${costNote ? `, ${costNote}` : ''}`,
      data: {
        kind: 'block',
        label,
        service,
        category,
        summary: [service, skuSummary(block)].filter(Boolean).join(' · '),
        cost: costText,
        costZero: cost?.zero ?? true,
        costNote,
      },
    };
  });
  return [client, ...blocks];
}

/** Arestas do canvas derivadas do design e da seleção. Função pura. */
export function toCanvasEdges(doc: DesignDocument, selection: Selection): CanvasEdge[] {
  const typeOf = new Map(doc.blocks.map((block) => [block.id, block.type]));
  const nameOf = (id: string) =>
    id === CLIENT_NODE_ID ? 'Internet' : serviceName(typeOf.get(id) ?? '');
  return doc.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    selected: selection?.kind === 'edge' && selection.id === edge.id,
    ariaLabel: `${KIND_LABELS[edge.kind]}: ${nameOf(edge.source)} para ${nameOf(edge.target)}`,
    data: { kind: edge.kind },
  }));
}
