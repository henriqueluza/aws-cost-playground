import blocksFile from '../../../../../contracts/blocks.json';
import edgesFile from '../../../../../contracts/edges.json';
import { CLIENT_NODE_ID, type EdgeKind } from '../../../shared/lib/design';
import {
  blocksFileSchema,
  edgesFileSchema,
  type BlockDefinition,
  type BlockPricer,
  type BlockType,
  type EdgeKindDefinition,
} from './blockContract';
import { BLOCK_PRICERS } from './blocks';

/** Definições de `contracts/blocks.json`, validadas na carga do módulo. */
export const BLOCKS: readonly BlockDefinition[] = blocksFileSchema.parse(blocksFile).blocks;
/** Definições de `contracts/edges.json`, validadas na carga do módulo. */
export const EDGE_KIND_DEFINITIONS: readonly EdgeKindDefinition[] =
  edgesFileSchema.parse(edgesFile).kinds;

const definitions = new Map<string, BlockDefinition>(BLOCKS.map((block) => [block.type, block]));

/** Definição de um tipo de bloco do design; `undefined` se o tipo não está no contrato. */
export function blockDefinition(type: string): BlockDefinition | undefined {
  return definitions.get(type);
}

/** Função de preço de um tipo de bloco; `undefined` se o tipo não está no contrato. */
export function blockPricer(type: string): BlockPricer | undefined {
  return definitions.has(type) ? BLOCK_PRICERS[type as BlockType] : undefined;
}

/**
 * Tipos de aresta aceitos entre dois tipos de bloco, na ordem de `contracts/edges.json`.
 * `targetType` é o tipo do bloco de destino ou `client`. Lista vazia: conexão inválida.
 */
export function edgeKindsFor(sourceType: string, targetType: string): EdgeKind[] {
  const known = (type: string) => definitions.has(type);
  if (!known(sourceType) || (targetType !== CLIENT_NODE_ID && !known(targetType))) return [];
  return EDGE_KIND_DEFINITIONS.filter((edge) =>
    edge.pairs.some(
      (pair) =>
        pair.sources.some((type) => type === sourceType) &&
        pair.targets.some((type) => type === targetType),
    ),
  ).map((edge) => edge.kind);
}

export {
  BLOCK_CATEGORIES,
  BLOCK_TYPES,
  PRD_BLOCK_LEVELS,
  type AttributeDefinition,
  type BlockCategory,
  type BlockCharge,
  type BlockDefinition,
  type BlockLevel,
  type BlockPriceInput,
  type BlockPricer,
  type BlockType,
  type EdgeKindDefinition,
  type UsageKeyDefinition,
} from './blockContract';
