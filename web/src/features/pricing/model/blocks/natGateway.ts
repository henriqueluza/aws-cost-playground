import type { BlockPricer } from '../blockContract';

/**
 * `aws.nat-gateway`: um gateway por bloco. Emite sempre, mesmo com uso zero:
 * - `nat-gateway-hours`: 730 h, custo fixo;
 * - `nat-gateway-data-processed`: `processedGbPerMonth` em GB, variável.
 * Entrada fora do contrato (que `blockPriceInput` já recusa) lança `RangeError`, nunca custo zero.
 */
export const priceNatGateway: BlockPricer = () => {
  throw new Error('a implementar (#36)');
};
