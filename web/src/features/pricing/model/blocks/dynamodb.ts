import { decimal, mul } from '../../../../shared/lib/money';
import type { BlockCharge, BlockPricer } from '../blockContract';

/** Horas de um mês na calculadora da AWS (o padrão do EC2); o contrato do DynamoDB não tem horas. */
const HOURS_PER_MONTH = decimal(730);

/**
 * `aws.dynamodb`: as três cobranças do modo de capacidade, emitidas mesmo com uso zero.
 * Sob demanda: unidades de requisição de leitura e de escrita e GB-mês. Provisionado: RCU-hora e
 * WCU-hora (unidades × 730 h, custo fixo) e GB-mês. Só as chaves de uso do modo ativo são lidas.
 * Simplificação: 1 requisição = 1 unidade (leitura fortemente consistente até 4 KB, escrita até
 * 1 KB). A franquia (25 GB, 18.600 unidades-hora de leitura e de escrita) e os preços ficam no
 * catálogo, não aqui.
 * Fora de escopo: classe Standard-IA, tabelas globais, PITR e backup, streams, capacidade
 * reservada e auto scaling.
 * Entrada fora do contrato (que `blockPriceInput` já recusa) lança `RangeError`, nunca custo zero.
 */
export const priceDynamoDb: BlockPricer = ({ attributes, usage }) => {
  // Igualdade estrita: chave do protótipo (ex.: `toString`) não casa.
  const { capacityMode } = attributes;
  if (capacityMode !== 'on-demand' && capacityMode !== 'provisioned') {
    throw new RangeError('aws.dynamodb: modo de capacidade fora do contrato');
  }
  const onDemand = capacityMode === 'on-demand';
  const reads = onDemand ? usage.readRequestsPerMonth : usage.provisionedReadUnits;
  const writes = onDemand ? usage.writeRequestsPerMonth : usage.provisionedWriteUnits;
  const { storageGb } = usage;
  if (reads === undefined || writes === undefined || storageGb === undefined) {
    throw new RangeError('aws.dynamodb: uso fora do contrato');
  }
  const storage: BlockCharge = {
    sku: 'dynamodb-storage',
    quantity: decimal(storageGb),
    charge: 'variable',
  };
  if (onDemand) {
    return [
      { sku: 'dynamodb-read-requests', quantity: decimal(reads), charge: 'variable' },
      { sku: 'dynamodb-write-requests', quantity: decimal(writes), charge: 'variable' },
      storage,
    ];
  }
  return [
    {
      sku: 'dynamodb-read-capacity',
      quantity: mul(decimal(reads), HOURS_PER_MONTH),
      charge: 'fixed',
    },
    {
      sku: 'dynamodb-write-capacity',
      quantity: mul(decimal(writes), HOURS_PER_MONTH),
      charge: 'fixed',
    },
    storage,
  ];
};
