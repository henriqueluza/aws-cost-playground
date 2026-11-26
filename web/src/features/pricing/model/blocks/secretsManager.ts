import { decimal } from '../../../../shared/lib/money';
import type { BlockPricer } from '../blockContract';

/**
 * `aws.secrets-manager`: segredos e chamadas de API, emitidos mesmo com uso zero. O segredo é
 * custo fixo: cobrado por existir, pelo mês inteiro (sem rateio por hora). As chamadas são
 * variáveis. Sem franquia: o trial de 30 dias fica de fora.
 * Entrada fora do contrato (que `blockPriceInput` já recusa) lança `RangeError`, nunca custo zero.
 */
export const priceSecretsManager: BlockPricer = ({ usage }) => {
  const { secrets, apiCallsPerMonth } = usage;
  if (secrets === undefined || apiCallsPerMonth === undefined) {
    throw new RangeError('aws.secrets-manager: uso fora do contrato');
  }
  return [
    { sku: 'secrets-manager-secrets', quantity: decimal(secrets), charge: 'fixed' },
    {
      sku: 'secrets-manager-api-requests',
      quantity: decimal(apiCallsPerMonth),
      charge: 'variable',
    },
  ];
};
