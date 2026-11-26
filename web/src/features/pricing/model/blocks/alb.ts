import { compare, decimal, div, mul } from '../../../../shared/lib/money';
import type { BlockPricer } from '../blockContract';

/** Horas de um mês na calculadora da AWS (o padrão do EC2); o contrato do ALB não tem horas. */
const HOURS_PER_MONTH = decimal(730);
/** Capacidade de uma LCU em cada dimensão por hora (alvos EC2/IP). */
const NEW_CONNECTIONS_PER_SECOND_PER_LCU = decimal(25);
const ACTIVE_CONNECTIONS_PER_MINUTE_PER_LCU = decimal(3000);
const RULE_EVALUATIONS_PER_SECOND_PER_LCU = decimal(1000);

/**
 * `aws.alb`: um balanceador por bloco. Emite sempre, mesmo com uso zero:
 * - `alb-hours`: 730 h, custo fixo;
 * - `alb-lcu-hours`: LCU-hora do mês, variável, a maior das quatro dimensões da LCU:
 *   `max(new × 730 / 25, active × 730 / 3000, processedGb, rules × 730 / 1000)`. O GB processado
 *   já é LCU-hora do mês (1 GB/h por LCU × 730 h). Multiplica por 730 antes de dividir: um só
 *   arredondamento.
 * Simplificações: alvos EC2/IP (alvo Lambda tem 0,4 GB/h por LCU e fica fora); tráfego uniforme no
 * mês (a AWS cobra a maior dimensão de cada hora); `ruleEvaluationsPerSecond` são as avaliações já
 * cobradas, além das 10 regras grátis por requisição.
 * Fora de escopo: LCU reservada, mTLS/trust store e a franquia de 12 meses de conta nova.
 * Entrada fora do contrato (que `blockPriceInput` já recusa) lança `RangeError`, nunca custo zero.
 */
export const priceAlb: BlockPricer = ({ usage }) => {
  const {
    newConnectionsPerSecond,
    activeConnectionsPerMinute,
    processedGbPerMonth,
    ruleEvaluationsPerSecond,
  } = usage;
  if (
    newConnectionsPerSecond === undefined ||
    activeConnectionsPerMinute === undefined ||
    processedGbPerMonth === undefined ||
    ruleEvaluationsPerSecond === undefined
  ) {
    throw new RangeError('aws.alb: uso fora do contrato');
  }
  const lcuHours = [
    div(mul(decimal(newConnectionsPerSecond), HOURS_PER_MONTH), NEW_CONNECTIONS_PER_SECOND_PER_LCU),
    div(
      mul(decimal(activeConnectionsPerMinute), HOURS_PER_MONTH),
      ACTIVE_CONNECTIONS_PER_MINUTE_PER_LCU,
    ),
    decimal(processedGbPerMonth),
    div(
      mul(decimal(ruleEvaluationsPerSecond), HOURS_PER_MONTH),
      RULE_EVALUATIONS_PER_SECOND_PER_LCU,
    ),
  ].reduce((max, dimension) => (compare(dimension, max) > 0 ? dimension : max));
  return [
    { sku: 'alb-hours', quantity: HOURS_PER_MONTH, charge: 'fixed' },
    { sku: 'alb-lcu-hours', quantity: lcuHours, charge: 'variable' },
  ];
};
