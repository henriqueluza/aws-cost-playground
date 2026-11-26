import {
  DESIGN_LIMITS,
  type DesignDocument,
  type Edge,
  type Usage,
} from '../../../shared/lib/design';
import type { EstimateRequest, EstimateResponse } from '../../../shared/lib/api';

/** Limite da descrição, contado em unidades UTF-16 (`string.length`): o mesmo do schema do documento. */
export const DESCRIPTION_LIMIT = DESIGN_LIMITS.maxDescriptionLength;

/** Faixa de uma chave de uso, como em `contracts/`. O model não importa `pricing`: o contrato entra por aqui. */
export type UsageKeySpec = {
  readonly key: string;
  readonly min: number;
  readonly max: number;
  readonly integer: boolean;
};
export type UsageContract = {
  block(type: string): readonly UsageKeySpec[] | undefined;
  edge(kind: Edge['kind']): readonly UsageKeySpec[] | undefined;
};

/** O que a API recebe: o diagrama sem rótulo, uso e override, mais a descrição. */
export function toEstimateRequest(doc: DesignDocument): EstimateRequest {
  return {
    region: doc.region,
    description: doc.workload.description,
    blocks: doc.blocks.map(({ id, type, attributes }) => ({ id, type, attributes })),
    edges: doc.edges.map(({ id, source, target, kind }) => ({ id, source, target, kind })),
  };
}

const sortKeys = (record: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

/**
 * Impressão digital do que a estimativa lê: descrição, blocos (id, tipo, atributos) e arestas
 * (id, pontas, tipo). Rótulo, uso, override, posição e região ficam de fora: não mudam o pedido
 * nem o que a LLM vê (a região não vai para ela), e aplicar a estimativa não pode se marcar velha.
 */
export function estimateFingerprint(doc: DesignDocument): string {
  const { description, blocks, edges } = toEstimateRequest(doc);
  return JSON.stringify([
    description,
    blocks.map((b) => [b.id, b.type, sortKeys(b.attributes)]),
    edges.map((e) => [e.id, e.source, e.target, e.kind]),
  ]);
}

/** `never`: nenhuma estimativa nesta sessão da tela; `fresh`/`stale`: a última bate ou não com o atual. */
export type Freshness = 'never' | 'fresh' | 'stale';

export function freshness(estimatedFingerprint: string | null, doc: DesignDocument): Freshness {
  if (estimatedFingerprint === null) return 'never';
  return estimatedFingerprint === estimateFingerprint(doc) ? 'fresh' : 'stale';
}

export type Applied = {
  readonly document: DesignDocument;
  /** Blocos e arestas que receberam `usage` novo. */
  readonly blocks: number;
  readonly edges: number;
};

type Item = EstimateResponse['blocks'][number];

/** Só chave do contrato, número finito dentro da faixa e inteiro onde o contrato pede. */
function acceptedValues(
  values: Item['values'],
  specs: readonly UsageKeySpec[] | undefined,
): Record<string, number> {
  const accepted: Record<string, number> = {};
  for (const spec of specs ?? []) {
    if (!Object.hasOwn(values, spec.key)) continue;
    const value = values[spec.key];
    const ok =
      typeof value === 'number' &&
      Number.isFinite(value) &&
      value >= spec.min &&
      value <= spec.max &&
      (!spec.integer || Number.isInteger(value));
    if (ok) accepted[spec.key] = value;
  }
  return accepted;
}

/** `usage` novo de um item, ou `undefined` se nada nele é aceitável (o item fica como estava). */
function nextUsage(
  item: Item | undefined,
  specs: readonly UsageKeySpec[] | undefined,
  now: string,
): Usage | undefined {
  if (!item) return undefined;
  const values = acceptedValues(item.values, specs);
  if (Object.keys(values).length === 0) return undefined;
  return { source: item.source, estimatedAt: now, values };
}

/** Primeira ocorrência de cada id; a repetida é ignorada. */
const byId = (items: readonly Item[]): Map<string, Item> => {
  const map = new Map<string, Item>();
  for (const item of items) if (!map.has(item.id)) map.set(item.id, item);
  return map;
};

/**
 * Aplica a resposta ao documento ATUAL (não ao de quando o pedido saiu): troca `usage` inteiro
 * dos blocos e arestas que ainda existem e cuja resposta tem ao menos um valor aceitável, e
 * nunca toca em `overrides` nem em mais nada. Id que não está no documento, chave fora do
 * contrato do tipo, número fora da faixa ou fracionário em chave inteira são recusados.
 */
export function applyEstimate(
  doc: DesignDocument,
  response: Pick<EstimateResponse, 'blocks' | 'edges'>,
  contract: UsageContract,
  now: string,
): Applied {
  const blockItems = byId(response.blocks);
  const edgeItems = byId(response.edges);
  let blocks = 0;
  let edges = 0;
  const document: DesignDocument = {
    ...doc,
    blocks: doc.blocks.map((block) => {
      const usage = nextUsage(blockItems.get(block.id), contract.block(block.type), now);
      if (!usage) return block;
      blocks += 1;
      return { ...block, usage };
    }),
    edges: doc.edges.map((edge) => {
      const usage = nextUsage(edgeItems.get(edge.id), contract.edge(edge.kind), now);
      if (!usage) return edge;
      edges += 1;
      return { ...edge, usage };
    }),
  };
  return { document, blocks, edges };
}
