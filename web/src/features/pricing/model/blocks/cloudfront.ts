import { decimal } from '../../../../shared/lib/money';
import type { BlockPricer } from '../blockContract';

/**
 * `aws.cloudfront`: cobra as requisições HTTPS do mês, pelo preço das bordas do continente da
 * região do design (us-east-1 → Estados Unidos, sa-east-1 → América do Sul). A saída para a
 * internet (SKU `cloudfront-data-transfer-out`, por faixa de volume e com franquia de 1 TB) é
 * cobrada pela aresta `data` CloudFront → `client`, da #42, e por isso não sai daqui.
 * Fora de escopo: requisições HTTP, requisições proxy (PUT/POST/…), CloudFront Functions,
 * invalidações e Origin Shield.
 * Uso fora do contrato (que `blockPriceInput` já recusa) lança `RangeError`, nunca custo zero.
 */
export const priceCloudFront: BlockPricer = ({ usage }) => {
  const { requestsPerMonth } = usage;
  if (requestsPerMonth === undefined) throw new RangeError('aws.cloudfront: uso fora do contrato');
  return [
    { sku: 'cloudfront-https-requests', quantity: decimal(requestsPerMonth), charge: 'variable' },
  ];
};
