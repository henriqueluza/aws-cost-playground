import {
  CLIENT_NODE_ID,
  effectiveUsage,
  type Block,
  type DesignDocument,
} from '../../../shared/lib/design';
import { blockDefinition, type BlockDefinition } from '../../pricing';
import type { ExportBlock, ExportLink } from './generator';
import { uniqueNames } from './names';

/** Bloco que não pôde ser lido pelo contrato e por isso não chega a nenhum gerador. */
export interface RejectedBlock {
  readonly id: string;
  readonly type: string;
  readonly label: string;
  readonly reason: 'unknown-type' | 'invalid-attribute';
}

export interface ExportModel {
  /** Blocos conferidos, na ordem do id. */
  readonly blocks: readonly ExportBlock[];
  readonly rejected: readonly RejectedBlock[];
  /** Arestas de cada bloco conferido, por id do bloco. */
  readonly links: ReadonlyMap<string, readonly ExportLink[]>;
}

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Atributos do contrato para o bloco: só as chaves conhecidas, cada uma com uma das opções aceitas.
 * Ausente recebe o padrão. Valor fora das opções recusa o bloco (`undefined`): nada é adivinhado.
 */
function contractAttributes(
  definition: BlockDefinition,
  block: Block,
): Record<string, string | number> | undefined {
  const attributes: Record<string, string | number> = {};
  for (const { key, options, default: fallback } of definition.attributes) {
    const value = Object.hasOwn(block.attributes, key) ? block.attributes[key] : fallback;
    if (value === undefined) continue;
    const option = options.find((candidate) => candidate === value);
    if (option === undefined) return undefined;
    attributes[key] = option;
  }
  return attributes;
}

/** Uso efetivo, só com as chaves do contrato: ausente recebe o padrão e o valor é limitado à faixa. */
function contractUsage(definition: BlockDefinition, block: Block): Record<string, number> {
  const informed = effectiveUsage(block.usage, block.overrides);
  const usage: Record<string, number> = {};
  for (const { key, default: fallback, min, max, integer } of definition.usage) {
    const given = Object.hasOwn(informed, key) ? informed[key] : undefined;
    const value = Math.min(Math.max(given ?? fallback, min), max);
    usage[key] = integer ? Math.ceil(value) : value;
  }
  return usage;
}

/**
 * Lê o design pelo contrato dos blocos. A ordem de saída é a do id, não a do documento: o mesmo
 * conjunto de blocos e arestas dá sempre o mesmo resultado, e os mesmos nomes de recurso.
 */
export function buildExportModel(design: DesignDocument): ExportModel {
  const sorted = [...design.blocks].sort(byId);
  const names = uniqueNames(
    sorted.map((block) => ({
      id: block.id,
      text: block.label,
      fallback: block.type.replace(/^aws\./, ''),
    })),
  );

  const blocks: ExportBlock[] = [];
  const rejected: RejectedBlock[] = [];
  for (const block of sorted) {
    const definition = blockDefinition(block.type);
    const attributes = definition && contractAttributes(definition, block);
    if (!definition || !attributes) {
      const reason = definition ? 'invalid-attribute' : 'unknown-type';
      rejected.push({ id: block.id, type: block.type, label: block.label, reason });
      continue;
    }
    blocks.push({
      id: block.id,
      type: definition.type,
      name: names.get(block.id) ?? '',
      label: block.label,
      attributes,
      usage: contractUsage(definition, block),
    });
  }

  const known = new Map(blocks.map((block) => [block.id, block]));
  const links = new Map<string, ExportLink[]>(blocks.map((block) => [block.id, []]));
  for (const edge of [...design.edges].sort(byId)) {
    const source = known.get(edge.source);
    const target = known.get(edge.target);
    // Aresta para um bloco recusado não vira ligação: o gerador não recebe par que não conhece.
    if (!source || (edge.target !== CLIENT_NODE_ID && !target)) continue;
    links.get(source.id)?.push({ kind: edge.kind, role: 'source', peer: target });
    if (target) links.get(target.id)?.push({ kind: edge.kind, role: 'target', peer: source });
  }
  return { blocks, rejected, links };
}
