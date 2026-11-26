import type { Block, DesignDocument, Edge, Usage } from '../../../shared/lib/design';

/** Posição de um nó no canvas, em pixels do plano do diagrama. */
export type Position = { readonly x: number; readonly y: number };

/**
 * Posições por id de bloco (ou `client`). Fica fora do `DesignDocument`, que não tem posição no
 * schema; bloco sem entrada é posicionado pelo canvas.
 */
export type Layout = Readonly<Record<string, Position>>;

/** Bloco ou aresta do documento, pelo id. */
export type ElementRef = { readonly kind: 'block' | 'edge'; readonly id: string };
export type Selection = ElementRef | null;

/** O design em edição: o documento, as posições e o elemento selecionado. */
export type EditorState = {
  readonly document: DesignDocument;
  readonly layout: Layout;
  readonly selection: Selection;
};

/** Por que uma ação foi recusada. A frase para o usuário é de quem consome, não do model. */
export type ActionErrorCode =
  | 'duplicate-id'
  | 'unknown-block'
  | 'unknown-edge'
  | 'self-loop'
  | 'client-edge-kind'
  | 'kind-not-allowed'
  | 'limit-exceeded'
  | 'invalid-position'
  | 'invalid-document';
export type ActionError = { readonly code: ActionErrorCode };

/** Resultado de uma ação: recusada, ela não altera nada. */
export type Result<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: ActionError };

/** Bloco novo, antes de ganhar id. Os `overrides` começam vazios. */
export type NewBlock = Pick<Block, 'type' | 'label' | 'attributes' | 'usage'>;
/** `attributes` substitui o record inteiro; `id` e `type` não mudam. */
export type BlockPatch = { readonly label?: string; readonly attributes?: Block['attributes'] };
/** Aresta nova, antes de ganhar id. Sem `usage`, começa com `DEFAULT_EDGE_USAGE`. */
export type NewEdge = Pick<Edge, 'source' | 'target' | 'kind'> & { readonly usage?: Usage };

export const EMPTY_DESIGN: DesignDocument = {
  schemaVersion: 1,
  region: 'us-east-1',
  workload: { description: '' },
  blocks: [],
  edges: [],
  scenarios: [],
};

export const EMPTY_STATE: EditorState = { document: EMPTY_DESIGN, layout: {}, selection: null };

export const DEFAULT_EDGE_USAGE: Usage = { source: 'default', values: {} };
