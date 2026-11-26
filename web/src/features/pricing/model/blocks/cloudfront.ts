import { decimal } from '../../../../shared/lib/money';
import type { BlockPricer } from '../blockContract';

/**
 * `aws.cloudfront`: cobra as requisições HTTPS do mês. A saída para a internet (SKU
 * `cloudfront-data-transfer-out`, por faixa de volume e com franquia de 1 TB) é cobrada pela
 * aresta `data` CloudFront → `client`, da #42, e por isso não sai daqui.
 */
export const priceCloudFront: BlockPricer = ({ usage }) => [
  {
    sku: 'cloudfront-https-requests',
    // `blockPriceInput` garante a chave do contrato; o `?? 0` só satisfaz `noUncheckedIndexedAccess`.
    quantity: decimal(usage.requestsPerMonth ?? 0),
    charge: 'variable',
  },
];
