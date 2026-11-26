import type { BlockPricer } from '../blockContract';

/**
 * `aws.alb`: um balanceador por bloco. Emite sempre, mesmo com uso zero:
 * - `alb-hours`: 730 h, custo fixo;
 * - `alb-lcu-hours`: LCU-hora do mês, variável, a maior das quatro dimensões da LCU (alvos EC2/IP,
 *   tráfego uniforme no mês): `max(new × 730 / 25, active × 730 / 3000, processedGb,
 *   rules × 730 / 1000)`.
 * Entrada fora do contrato (que `blockPriceInput` já recusa) lança `RangeError`, nunca custo zero.
 */
export const priceAlb: BlockPricer = () => {
  throw new Error('a implementar (#36)');
};
