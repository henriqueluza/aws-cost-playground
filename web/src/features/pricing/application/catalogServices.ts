import type { DesignDocument } from '../../../shared/lib/design';
import { blockPriceInput } from '../model/blockInput';
import { blockDefinition, blockPricer } from '../model/blockRegistry';
import { blockService, type BlockPricing } from '../model/engine';
import { zeroCostRule } from '../model/zeroCost';

const registry: BlockPricing = { definition: blockDefinition, pricer: blockPricer };

/**
 * Serviços do catálogo de que o motor precisa para estimar o design: o serviço de cada tipo de
 * bloco do contrato (o tipo sem `aws.`) e o `service` que uma cobrança do bloco declarar. Sai sem
 * repetição e em ordem alfabética, para a mesma lista dar a mesma query key. Bloco de tipo fora
 * do contrato e bloco de custo zero (`zeroCostPricer`: IAM, CloudFormation, ECS) não pedem
 * serviço; as arestas não pedem nenhum até a #42.
 */
export function catalogServices(
  design: Pick<DesignDocument, 'blocks'>,
  blocks: BlockPricing = registry,
): string[] {
  const services = new Set<string>();
  for (const block of design.blocks) {
    const definition = blocks.definition(block.type);
    const pricer = blocks.pricer(block.type);
    if (!definition || zeroCostRule(pricer)) continue;
    services.add(blockService(block.type));
    const input = blockPriceInput(definition, block);
    const charges = input ? (pricer?.(input) ?? []) : [];
    for (const charge of charges) if (charge.service !== undefined) services.add(charge.service);
  }
  return [...services].sort();
}
