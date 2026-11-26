import type { DesignDocument } from '../../../shared/lib/design';
import type { BlockDefinition } from './blockContract';

/**
 * Por que um bloco `priced` de nível C sai com zero. `no-direct-cost`: o serviço não cobra
 * (IAM, CloudFormation). `billed-on-host`: o custo está nos blocos ligados pela aresta `runs-on`
 * (ECS sobre EC2), na ordem de `design.edges` e sem repetição; vazio se falta a aresta.
 */
export type CostNote =
  | { readonly kind: 'no-direct-cost' }
  | { readonly kind: 'billed-on-host'; readonly hostBlockIds: readonly string[] };

/** `missing-runs-on`: bloco que roda sobre outro (ECS) sem aresta `runs-on` válida. */
export type CostWarningCode = 'missing-runs-on';

/** Problema do design que não impede o cálculo. */
export interface CostWarning {
  readonly code: CostWarningCode;
  /** `Block.id` do bloco com o problema. */
  readonly blockId: string;
}

export interface ZeroCostReport {
  /** Nota de cada bloco de nível C do contrato, por `Block.id`. Tipo fora do contrato não entra. */
  readonly notes: ReadonlyMap<string, CostNote>;
  /** Um aviso por bloco hospedado sem host válido, na ordem de `design.blocks`. */
  readonly warnings: readonly CostWarning[];
}

/**
 * Notas e avisos dos blocos de custo zero (nível C). Um tipo é hospedado se é origem de algum par
 * da aresta `runs-on` em `contracts/edges.json`; uma aresta `runs-on` só conta como host se o par
 * (origem, destino) é aceito pelo contrato (`edgeKindsFor`). Pura; não lança.
 */
export function zeroCostReport(
  design: Pick<DesignDocument, 'blocks' | 'edges'>,
  definition: (type: string) => BlockDefinition | undefined,
): ZeroCostReport {
  void design;
  void definition;
  return { notes: new Map(), warnings: [] };
}
