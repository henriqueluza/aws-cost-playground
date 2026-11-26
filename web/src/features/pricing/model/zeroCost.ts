import type { DesignDocument } from '../../../shared/lib/design';
import type { BlockPricer } from './blockContract';

/**
 * Por que um bloco não tem cobrança própria, declarado no arquivo do bloco (`zeroCostPricer`).
 * `no-direct-cost`: a AWS não cobra pelo recurso (IAM, CloudFormation). `billed-on-host`: o custo
 * é dos blocos de tipo `hostTypes` ligados pela aresta `runs-on` (ECS sobre EC2).
 */
export type ZeroCostRule =
  | { readonly kind: 'no-direct-cost' }
  | { readonly kind: 'billed-on-host'; readonly hostTypes: readonly string[] };

/** Função de preço de bloco de custo zero: nunca cobra e carrega o motivo. */
export type ZeroCostPricer = BlockPricer & { readonly zeroCost: ZeroCostRule };

/** Cria a função de preço de um bloco de custo zero: sem cobranças, não pede arquivo de preço. */
export function zeroCostPricer(rule: ZeroCostRule): ZeroCostPricer {
  return Object.assign((): readonly [] => [], { zeroCost: rule });
}

/** Regra de custo zero de uma função de preço; `undefined` se o bloco tem cobrança própria. */
export function zeroCostRule(pricer: BlockPricer | undefined): ZeroCostRule | undefined {
  return (pricer as Partial<ZeroCostPricer> | undefined)?.zeroCost;
}

/**
 * Por que um bloco `priced` sai com zero. `no-direct-cost`: o serviço não cobra pelo recurso.
 * `billed-on-host`: o custo está nos blocos `hostBlockIds`, ligados pela aresta `runs-on`, na
 * ordem de `design.edges` e sem repetição; vazio se falta a aresta (há um aviso no resultado).
 */
export type CostNote =
  | { readonly kind: 'no-direct-cost' }
  | { readonly kind: 'billed-on-host'; readonly hostBlockIds: readonly string[] };

/** `missing-runs-on`: bloco que roda sobre outro (ECS) sem aresta `runs-on` para um host aceito. */
export type CostWarningCode = 'missing-runs-on';

/** Problema do design que não impede o cálculo. */
export interface CostWarning {
  readonly code: CostWarningCode;
  /** `Block.id` do bloco com o problema. */
  readonly blockId: string;
}

export interface ZeroCostReport {
  /** Nota de cada bloco de custo zero, por `Block.id`. */
  readonly notes: ReadonlyMap<string, CostNote>;
  /** Um aviso por bloco hospedado sem host, na ordem de `design.blocks`. */
  readonly warnings: readonly CostWarning[];
}

/**
 * Notas e avisos dos blocos de custo zero do design. Uma aresta `runs-on` só conta como host se
 * parte do bloco e chega a um bloco de tipo aceito pela regra dele. Pura; não lança.
 */
export function zeroCostReport(
  design: Pick<DesignDocument, 'blocks' | 'edges'>,
  pricer: (type: string) => BlockPricer | undefined,
): ZeroCostReport {
  const typeOf = new Map(design.blocks.map((block) => [block.id, block.type]));
  const notes = new Map<string, CostNote>();
  const warnings: CostWarning[] = [];
  for (const block of design.blocks) {
    const rule = zeroCostRule(pricer(block.type));
    if (rule === undefined) continue;
    if (rule.kind === 'no-direct-cost') {
      notes.set(block.id, { kind: 'no-direct-cost' });
      continue;
    }
    const hosts = design.edges
      .filter((edge) => edge.kind === 'runs-on' && edge.source === block.id)
      .map((edge) => edge.target)
      .filter((target) => rule.hostTypes.includes(typeOf.get(target) ?? ''));
    const hostBlockIds = [...new Set(hosts)];
    notes.set(block.id, { kind: 'billed-on-host', hostBlockIds });
    if (hostBlockIds.length === 0) warnings.push({ code: 'missing-runs-on', blockId: block.id });
  }
  return { notes, warnings };
}
