import { decimal } from '../../../../shared/lib/money';
import type { BlockPricer } from '../blockContract';

/** SKU de MAU por nível do contrato. `Map`: chave do protótipo não casa. */
const TIER_SKU: ReadonlyMap<unknown, string> = new Map([
  ['lite', 'cognito-mau-lite'],
  ['essentials', 'cognito-mau-essentials'],
  ['plus', 'cognito-mau-plus'],
]);

/**
 * `aws.cognito`: usuários ativos por mês do nível do bloco, emitidos mesmo com uso zero. Regra da
 * AWS, aplicada pelo catálogo: a franquia de 10.000 MAU é dividida entre Lite e Essentials
 * (`pool`); Plus não tem franquia. As faixas do Lite são da conta, não do bloco.
 * Fora de escopo: MAU federado (SAML/OIDC), proteção avançada, multirregião e M2M.
 * Entrada fora do contrato (que `blockPriceInput` já recusa) lança `RangeError`, nunca custo zero.
 */
export const priceCognito: BlockPricer = ({ attributes, usage }) => {
  const sku = TIER_SKU.get(attributes.tier);
  const { monthlyActiveUsers } = usage;
  if (sku === undefined) throw new RangeError('aws.cognito: tier fora do contrato');
  if (monthlyActiveUsers === undefined) throw new RangeError('aws.cognito: uso fora do contrato');
  return [{ sku, quantity: decimal(monthlyActiveUsers), charge: 'variable' }];
};
