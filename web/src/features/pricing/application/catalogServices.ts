import type { DesignDocument } from '../../../shared/lib/design';
import { blockPriceInput } from '../model/blockInput';
import { blockDefinition, blockPricer } from '../model/blockRegistry';
import { edgeCharges } from '../model/edgeCharges';
import { blockService, type BlockPricing } from '../model/engine';

const registry: BlockPricing = { definition: blockDefinition, pricer: blockPricer };

/**
 * Serviços do catálogo de que o motor precisa para estimar o design: o serviço de cada tipo de
 * bloco do contrato (o tipo sem `aws.`) e o `service` que uma cobrança do bloco declarar. Sai sem
 * repetição e em ordem alfabética, para a mesma lista dar a mesma query key. Bloco de tipo fora
 * do contrato não pede serviço. Cada aresta pede o serviço das cobranças dela (`edgeCharges`):
 * `data-transfer`, `cloudfront`, `nat-gateway` ou `cloudwatch`; aresta sem custo não pede nenhum.
 */
export function catalogServices(
  design: Pick<DesignDocument, 'blocks' | 'edges'>,
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
  const blockById = new Map(design.blocks.map((block) => [block.id, block]));
  for (const edge of design.edges) {
    const charges = edgeCharges(edge, (id) => blockById.get(id), blocks.definition) ?? [];
    for (const charge of charges) services.add(charge.service);
  }
  return [...services].sort();
}
