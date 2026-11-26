import { decimal } from '../../../../shared/lib/money';
import type { BlockPricer } from '../blockContract';

/** SKU de requisições por tipo de fila do contrato. `Map`: chave do protótipo não casa. */
const QUEUE_TYPE_SKU: ReadonlyMap<unknown, string> = new Map([
  ['standard', 'sqs-requests-standard'],
  ['fifo', 'sqs-requests-fifo'],
]);

/**
 * `aws.sqs`: requisições do tipo de fila do bloco, emitidas mesmo com uso zero. Regra da AWS,
 * aplicada pelo catálogo: a franquia mensal de requisições é dividida entre filas padrão e FIFO
 * (`pool`); cada tipo tem as próprias faixas.
 * Fora de escopo: a cobrança de cada bloco de 64 KB de payload como uma requisição e a fila Fair.
 * Entrada fora do contrato (que `blockPriceInput` já recusa) lança `RangeError`, nunca custo zero.
 */
export const priceSqs: BlockPricer = ({ attributes, usage }) => {
  const sku = QUEUE_TYPE_SKU.get(attributes.queueType);
  const { requestsPerMonth } = usage;
  if (sku === undefined) throw new RangeError('aws.sqs: tipo de fila fora do contrato');
  if (requestsPerMonth === undefined) throw new RangeError('aws.sqs: uso fora do contrato');
  return [{ sku, quantity: decimal(requestsPerMonth), charge: 'variable' }];
};
