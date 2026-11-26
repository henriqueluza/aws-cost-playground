import type { EdgeKind, Region } from '../../../shared/lib/design';
import type { BlockType } from '../../pricing';
import type { HclNode } from './hcl';

/** Um bloco do design já conferido contra `contracts/blocks.json`. É tudo o que o gerador vê dele. */
export interface ExportBlock {
  readonly id: string;
  readonly type: BlockType;
  /** Nome de recurso do Terraform: saneado e único no design. Use-o como rótulo do recurso. */
  readonly name: string;
  /** Texto do usuário. Só entra no arquivo por `hcl.string` ou `hcl.comment`. */
  readonly label: string;
  /** Atributos do contrato, cada um com uma das opções aceitas (ou o padrão). */
  readonly attributes: Readonly<Record<string, string | number>>;
  /** Uso efetivo (override vence), só com as chaves do contrato e dentro da faixa. */
  readonly usage: Readonly<Record<string, number>>;
}

/** Uma aresta do design vista de um dos lados. `peer` é `undefined` quando o outro lado é a internet. */
export interface ExportLink {
  readonly kind: EdgeKind;
  /** `source`: o bloco é a origem da aresta; `target`: é o destino. */
  readonly role: 'source' | 'target';
  readonly peer: ExportBlock | undefined;
}

export interface GeneratorInput {
  readonly block: ExportBlock;
  /** Arestas que tocam o bloco, na ordem do id da aresta. */
  readonly links: readonly ExportLink[];
  /** Todos os blocos exportáveis do design, para o que é gerado uma vez só (rede, AZs). */
  readonly blocks: readonly ExportBlock[];
  /** Arestas de todos os blocos, por id do bloco: o que é gerado uma vez só enxerga quem fala com quem. */
  readonly designLinks: ReadonlyMap<string, readonly ExportLink[]>;
  readonly region: Region;
}

export interface GeneratorOutput {
  /** `false`: o bloco não virou recurso e entra na lista de não exportados do cabeçalho. */
  readonly exported: boolean;
  readonly nodes: readonly HclNode[];
}

/**
 * Gerador de um tipo de bloco: função pura, um arquivo por bloco em `generators/`.
 * Só devolve nós do construtor `hcl`; o recurso principal do bloco leva `block.name` como rótulo.
 */
export type BlockGenerator = (input: GeneratorInput) => GeneratorOutput;
