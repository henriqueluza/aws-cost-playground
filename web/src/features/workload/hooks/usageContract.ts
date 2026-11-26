import { EDGE_KIND_DEFINITIONS, blockDefinition } from '../../pricing';
import type { UsageContract } from '../model/estimateModel';

/** As faixas de `contracts/` (blocks.json e edges.json) pela porta pública do `pricing`. */
export const usageContract: UsageContract = {
  block: (type) => blockDefinition(type)?.usage,
  edge: (kind) => EDGE_KIND_DEFINITIONS.find((d) => d.kind === kind)?.usage,
};
