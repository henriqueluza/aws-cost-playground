import {
  CLIENT_NODE_ID,
  DESIGN_LIMITS,
  designDocumentSchema,
  type Block,
  type DesignDocument,
  type Edge,
  type EdgeKind,
  type Overrides,
  type Region,
  type Usage,
} from '../../../shared/lib/design';
import { allowedKinds, endpointType, retargetUsage } from './edgeKinds';
import type { ActionErrorCode, BlockPatch, ElementRef, Result } from './editorState';

type WithId = { readonly id: string };
type Priced = { readonly usage: Usage; readonly overrides: Overrides };

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = (code: ActionErrorCode): Result<never> => ({ ok: false, error: { code } });

/**
 * Rede final de toda ação: o schema julga o candidato e volta o `data` dele. O zod descarta chave
 * fora do contrato (e `__proto__` nos records) em vez de recusar; com o `data`, ela não fica no
 * estado nem chega ao JSON exportado.
 */
function commit(candidate: unknown): Result<DesignDocument> {
  const parsed = designDocumentSchema.safeParse(candidate);
  return parsed.success ? ok(parsed.data) : fail('invalid-document');
}

const hasId = (items: readonly WithId[], id: string) => items.some((item) => item.id === id);

/** Troca o item `id` por `change(item)`; `undefined` se o id não existe. */
function replaceById<T extends WithId>(items: readonly T[], id: string, change: (item: T) => T) {
  return hasId(items, id) ? items.map((item) => (item.id === id ? change(item) : item)) : undefined;
}

/** Aplica `change` ao bloco ou à aresta de `target`; alvo inexistente é recusado pelo tipo dele. */
function updatePriced(
  doc: DesignDocument,
  target: ElementRef,
  change: (element: Priced) => Partial<Priced>,
): Result<DesignDocument> {
  if (target.kind === 'block') {
    const blocks = replaceById(doc.blocks, target.id, (block) => ({ ...block, ...change(block) }));
    return blocks ? commit({ ...doc, blocks }) : fail('unknown-block');
  }
  const edges = replaceById(doc.edges, target.id, (edge) => ({ ...edge, ...change(edge) }));
  return edges ? commit({ ...doc, edges }) : fail('unknown-edge');
}

export function addBlock(doc: DesignDocument, block: Block): Result<DesignDocument> {
  if (hasId(doc.blocks, block.id)) return fail('duplicate-id');
  if (doc.blocks.length >= DESIGN_LIMITS.maxBlocks) return fail('limit-exceeded');
  return commit({ ...doc, blocks: [...doc.blocks, block] });
}

export function editBlock(
  doc: DesignDocument,
  id: string,
  patch: BlockPatch,
): Result<DesignDocument> {
  // Campo a campo, para que nenhuma outra chave do patch chegue ao bloco.
  const blocks = replaceById(doc.blocks, id, (block) => ({
    ...block,
    label: patch.label ?? block.label,
    attributes: patch.attributes ?? block.attributes,
  }));
  return blocks ? commit({ ...doc, blocks }) : fail('unknown-block');
}

/** Remove o bloco e, em cascata, toda aresta que parte dele ou chega a ele. */
export function removeBlock(doc: DesignDocument, id: string): Result<DesignDocument> {
  if (!hasId(doc.blocks, id)) return fail('unknown-block');
  return commit({
    ...doc,
    blocks: doc.blocks.filter((block) => block.id !== id),
    edges: doc.edges.filter((edge) => edge.source !== id && edge.target !== id),
  });
}

/** Aresta repetida (mesmo `source`, `target` e `kind`) não é recusada aqui. */
export function connect(doc: DesignDocument, edge: Edge): Result<DesignDocument> {
  const targetExists = edge.target === CLIENT_NODE_ID || hasId(doc.blocks, edge.target);
  if (!hasId(doc.blocks, edge.source) || !targetExists) return fail('unknown-block');
  if (edge.source === edge.target) return fail('self-loop');
  if (edge.target === CLIENT_NODE_ID && edge.kind !== 'data') return fail('client-edge-kind');
  if (hasId(doc.edges, edge.id)) return fail('duplicate-id');
  if (doc.edges.length >= DESIGN_LIMITS.maxEdges) return fail('limit-exceeded');
  return commit({ ...doc, edges: [...doc.edges, edge] });
}

export function removeEdge(doc: DesignDocument, id: string): Result<DesignDocument> {
  if (!hasId(doc.edges, id)) return fail('unknown-edge');
  return commit({ ...doc, edges: doc.edges.filter((edge) => edge.id !== id) });
}

/**
 * Troca o tipo da aresta por um que o contrato permite para o par de blocos. O uso e o override
 * seguem a regra de `retargetUsage` (só o que o novo tipo tem, dentro da faixa dele).
 */
export function setEdgeKind(
  doc: DesignDocument,
  id: string,
  kind: EdgeKind,
): Result<DesignDocument> {
  const edges = replaceById(doc.edges, id, (edge) => ({
    ...edge,
    kind,
    ...retargetUsage(edge, kind),
  }));
  const edge = doc.edges.find((e) => e.id === id);
  if (!edges || !edge) return fail('unknown-edge');
  const source = endpointType(doc, edge.source);
  const target = endpointType(doc, edge.target);
  const permitted = source !== undefined && target !== undefined && allowedKinds(source, target);
  if (!permitted || !permitted.includes(kind)) return fail('kind-not-allowed');
  return commit({ ...doc, edges });
}

/** Troca `usage` inteiro e não toca em `overrides`: o override sobrevive à re-estimativa (ADR-0001). */
export function setUsage(
  doc: DesignDocument,
  target: ElementRef,
  usage: Usage,
): Result<DesignDocument> {
  return updatePriced(doc, target, () => ({ usage }));
}

/** `null` remove a chave (sem erro se ela não existe); um número define a chave. */
export function setOverride(
  doc: DesignDocument,
  target: ElementRef,
  key: string,
  value: number | null,
): Result<DesignDocument> {
  // Chave do `Object.prototype` é recusada aqui, em vez de sumir em silêncio no `commit`.
  if (Object.hasOwn(Object.prototype, key)) return fail('invalid-document');
  return updatePriced(doc, target, ({ overrides }) => ({
    overrides:
      value === null
        ? Object.fromEntries(Object.entries(overrides).filter(([name]) => name !== key))
        : { ...overrides, [key]: value },
  }));
}

export function setRegion(doc: DesignDocument, region: Region): Result<DesignDocument> {
  return commit({ ...doc, region });
}

/** Documento de fora (arquivo, API). A mensagem do zod nunca sai daqui. */
export function parseDesign(raw: unknown): Result<DesignDocument> {
  return commit(raw);
}
