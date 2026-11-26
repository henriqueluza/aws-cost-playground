import { decimal, mul, sub } from '../../../../shared/lib/money';
import type { BlockPricer } from '../blockContract';

const ONE = decimal(1);

/**
 * `aws.cloudtrail`: eventos de gerenciamento das trilhas adicionais e eventos de dados, emitidos
 * mesmo com uso zero. Regra da AWS: a 1ª cópia dos eventos de gerenciamento na região é grátis e
 * cada trilha adicional paga a sua cópia, logo cobra (trilhas − 1) × eventos de gerenciamento;
 * eventos de dados pagam desde o primeiro. `dataEventsPerMonth` é o total entregue, somado entre
 * as trilhas, e não se multiplica por trilha. Cada bloco conta a própria 1ª trilha como grátis.
 * Fora de escopo: CloudTrail Insights, CloudTrail Lake, eventos de rede e o armazenamento dos logs
 * no S3. Entrada fora do contrato (que `blockPriceInput` já recusa) lança `RangeError`, nunca
 * custo zero.
 */
export const priceCloudTrail: BlockPricer = ({ usage }) => {
  const { trails, managementEventsPerMonth, dataEventsPerMonth } = usage;
  if (
    trails === undefined ||
    managementEventsPerMonth === undefined ||
    dataEventsPerMonth === undefined ||
    trails < 1
  ) {
    throw new RangeError('aws.cloudtrail: uso fora do contrato');
  }
  const paidCopies = sub(decimal(trails), ONE);
  return [
    {
      sku: 'cloudtrail-management-events',
      quantity: mul(paidCopies, decimal(managementEventsPerMonth)),
      charge: 'variable',
    },
    { sku: 'cloudtrail-data-events', quantity: decimal(dataEventsPerMonth), charge: 'variable' },
  ];
};
