import { CLIENT_NODE_ID, type DesignDocument } from '../../../shared/lib/design';

/** Tamanho do bloco (CSS `--node-width` e `--node-height`) e a folga entre linhas. */
const BLOCK = { width: 216, height: 94 } as const;
const ROW_GAP = 10;
/**
 * Corredor entre colunas: 52 px dão espaço às faixas paralelas de `planEdges` (com menos, as arestas
 * que saem do mesmo bloco ficam a 3 px umas das outras e dividem faixa; o React Flow só respeita a
 * faixa com corredor de pelo menos 40 px).
 */
const CORRIDOR = 52;

/** Passo horizontal entre colunas. */
export const COLUMN_PITCH = BLOCK.width + CORRIDOR;

export const ROW_PITCH = BLOCK.height + ROW_GAP;

type Point = { x: number; y: number };

/**
 * Posição de quem não tem entrada no layout. Função pura e determinística (mesmo design, mesmo
 * resultado), sem biblioteca de layout:
 *
 * - coluna = maior caminho desde um bloco sem entrada (aresta que fecha ciclo é ignorada);
 * - arestas de `logs` não alongam o caminho: quem só recebe `logs` (CloudWatch) fica uma coluna
 *   depois da sua origem mais funda, mas esse caminho não empurra mais ninguém;
 * - o `client` fica na coluna seguinte à da sua origem mais funda, não na última do desenho; sem
 *   nenhuma aresta para ele, fica na última coluna dos blocos, sem abrir uma nova;
 * - dentro da coluna, a linha segue a média das linhas das origens já postas (menos cruzamentos),
 *   e a ordem do design desempata.
 */
export function defaultLayout(doc: DesignDocument): Record<string, Point> {
  const incoming = (id: string) => doc.edges.filter((edge) => edge.target === id);
  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  const depthOf = (id: string): number => {
    const known = depth.get(id);
    if (known !== undefined) return known;
    visiting.add(id);
    const sources = incoming(id).filter(
      (edge) => edge.kind !== 'logs' && !visiting.has(edge.source),
    );
    const value = Math.max(-1, ...sources.map((edge) => depthOf(edge.source))) + 1;
    visiting.delete(id);
    depth.set(id, value);
    return value;
  };
  const column = new Map(doc.blocks.map((block) => [block.id, depthOf(block.id)] as const));
  for (const block of doc.blocks) {
    const edges = incoming(block.id);
    if (edges.length === 0 || edges.some((edge) => edge.kind !== 'logs')) continue;
    column.set(block.id, Math.max(0, ...edges.map((edge) => column.get(edge.source) ?? 0)) + 1);
  }
  const clientSources = incoming(CLIENT_NODE_ID).map((edge) => column.get(edge.source) ?? 0);
  const last = Math.max(-1, ...column.values());
  column.set(
    CLIENT_NODE_ID,
    clientSources.length > 0 ? Math.max(...clientSources) + 1 : Math.max(0, last),
  );

  const ids = [...doc.blocks.map((block) => block.id), CLIENT_NODE_ID];
  const row = new Map<string, number>();
  const columns = Math.max(0, ...column.values());
  for (let c = 0; c <= columns; c += 1) {
    const here = ids.filter((id) => column.get(id) === c);
    const key = (id: string): number => {
      const placed = incoming(id)
        .map((edge) => row.get(edge.source))
        .filter((r): r is number => r !== undefined);
      return placed.length > 0 ? placed.reduce((a, b) => a + b, 0) / placed.length : Infinity;
    };
    const order = here.map((id, index) => ({ id, index, key: key(id) }));
    order.sort((a, b) => (a.key === b.key ? a.index - b.index : a.key < b.key ? -1 : 1));
    order.forEach(({ id }, r) => row.set(id, r));
  }
  return Object.fromEntries(
    ids.map((id) => [
      id,
      { x: COLUMN_PITCH * (column.get(id) ?? 0), y: ROW_PITCH * (row.get(id) ?? 0) },
    ]),
  );
}
