import { decimal } from '../../../../shared/lib/money';
import type { BlockPricer } from '../blockContract';

/**
 * `aws.route53`: zonas hospedadas (custo fixo) e consultas DNS padrão (variável), emitidas mesmo
 * com uso zero. As faixas (25 zonas, 1 bilhão de consultas) e os preços ficam no catálogo, não
 * aqui, e valem por conta: os blocos somam antes da troca de faixa. Sem franquia.
 * Fora de escopo: consultas alias para recursos AWS, roteamento por latência, geolocalização e
 * IP, health checks, Traffic Flow e Resolver.
 * Entrada fora do contrato (que `blockPriceInput` já recusa) lança `RangeError`, nunca custo zero.
 */
export const priceRoute53: BlockPricer = ({ usage }) => {
  const { hostedZones, queriesPerMonth } = usage;
  if (hostedZones === undefined || queriesPerMonth === undefined) {
    throw new RangeError('aws.route53: uso fora do contrato');
  }
  return [
    { sku: 'route53-hosted-zones', quantity: decimal(hostedZones), charge: 'fixed' },
    { sku: 'route53-queries', quantity: decimal(queriesPerMonth), charge: 'variable' },
  ];
};
