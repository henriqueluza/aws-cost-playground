import { decimal } from '../../../../shared/lib/money';
import type { BlockPricer } from '../blockContract';

/** Horas de um mês na calculadora da AWS (o padrão do EC2); o contrato do NAT não tem horas. */
const HOURS_PER_MONTH = decimal(730);

/**
 * `aws.nat-gateway`: um gateway por bloco. Emite sempre, mesmo com uso zero:
 * - `nat-gateway-hours`: 730 h, custo fixo;
 * - `nat-gateway-data-processed`: `processedGbPerMonth` em GB, variável.
 * O GB processado que chega pelas arestas é custo de aresta, não deste bloco.
 * Fora de escopo: NAT Gateway regional, banda provisionada e transferência de dados.
 * Entrada fora do contrato (que `blockPriceInput` já recusa) lança `RangeError`, nunca custo zero.
 */
export const priceNatGateway: BlockPricer = ({ usage }) => {
  const { processedGbPerMonth } = usage;
  if (processedGbPerMonth === undefined) {
    throw new RangeError('aws.nat-gateway: uso fora do contrato');
  }
  return [
    { sku: 'nat-gateway-hours', quantity: HOURS_PER_MONTH, charge: 'fixed' },
    {
      sku: 'nat-gateway-data-processed',
      quantity: decimal(processedGbPerMonth),
      charge: 'variable',
    },
  ];
};
