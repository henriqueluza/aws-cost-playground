import type { DesignDocument } from '../../../shared/lib/design';
import { blockPriceInput } from '../model/blockInput';
import { blockDefinition, blockPricer } from '../model/blockRegistry';
import { blockService, type BlockPricing } from '../model/engine';

const registry: BlockPricing = { definition: blockDefinition, pricer: blockPricer };

/**
 * Serviços do catálogo de que o motor precisa para estimar o design: o serviço de cada tipo de
 * bloco do contrato (o tipo sem `aws.`) e o `service` que uma cobrança do bloco declarar. Sai sem
 * repetição e em ordem alfabética, para a mesma lista dar a mesma query key. Bloco de tipo fora
 * do contrato não pede serviço; as arestas não pedem nenhum até a #42.
 */
export function catalogServices(
  design: Pick<DesignDocument, 'blocks'>,
  blocks: BlockPricing = registry,
): string[] {
  const services = new Set<string>();
  for (const block of design.blocks) {
    const definition = blocks.definition(block.type);
    if (!definition) continue;
    services.add(blockService(block.type));
    const input = blockPriceInput(definition, block);
    const charges = input ? (blocks.pricer(block.type)?.(input) ?? []) : [];
    for (const charge of charges) if (charge.service !== undefined) services.add(charge.service);
  }
  return [...services].sort();
}
