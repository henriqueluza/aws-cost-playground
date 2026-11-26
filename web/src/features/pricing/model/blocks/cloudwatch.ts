import { decimal } from '../../../../shared/lib/money';
import type { BlockPricer } from '../blockContract';

/**
 * `aws.cloudwatch`: as quatro cobranças do bloco, emitidas mesmo com uso zero e nesta ordem:
 * ingestão de logs (GB), armazenamento de logs (GB-mês), métricas customizadas e alarmes.
 * Logs são custo variável. Métricas e alarmes são custo fixo: cobrados por existir no mês, como a
 * capacidade provisionada do DynamoDB.
 * O volume das arestas `logs` não passa por aqui: a aresta cobra o mesmo SKU de ingestão (#42) e o
 * motor soma as duas quantidades por conta, na mesma franquia. As franquias e as faixas de preço
 * ficam no catálogo e o rater as aplica, não aqui.
 * Fora de escopo: classe Infrequent Access, vended logs, Logs Insights, alarmes de alta resolução
 * e compostos, dashboards e requisições de API.
 * Entrada fora do contrato (que `blockPriceInput` já recusa) lança `RangeError`, nunca custo zero.
 */
export const priceCloudWatch: BlockPricer = ({ usage }) => {
  const { logsIngestedGbPerMonth, logsStoredGb, customMetrics, alarms } = usage;
  if (
    logsIngestedGbPerMonth === undefined ||
    logsStoredGb === undefined ||
    customMetrics === undefined ||
    alarms === undefined
  ) {
    throw new RangeError('aws.cloudwatch: uso fora do contrato');
  }
  return [
    {
      sku: 'cloudwatch-logs-ingestion',
      quantity: decimal(logsIngestedGbPerMonth),
      charge: 'variable',
    },
    { sku: 'cloudwatch-logs-storage', quantity: decimal(logsStoredGb), charge: 'variable' },
    { sku: 'cloudwatch-custom-metrics', quantity: decimal(customMetrics), charge: 'fixed' },
    { sku: 'cloudwatch-alarms', quantity: decimal(alarms), charge: 'fixed' },
  ];
};
