import { decimal } from '../../../../shared/lib/money';
import type { BlockPricer } from '../blockContract';

/**
 * `aws.s3`: armazenamento (GB-mês, em faixas no catálogo) e requisições PUT e GET da classe
 * `storageClass`. Sem franquia: a de 5 GB é de 12 meses e fica fora (`docs/scenarios.md`).
 * O sufixo do SKU vem do nome da classe (`STANDARD_IA` → `s3-storage-standard-ia`), sem tabela:
 * classe sem SKU no catálogo (ex.: `GLACIER`) ou que não é texto deixa a cobrança sem preço, e o
 * motor marca o bloco `unavailable`, nunca zero em silêncio.
 */
export const priceS3: BlockPricer = ({ attributes, usage }) => {
  const { storageClass } = attributes;
  const suffix =
    typeof storageClass === 'string' ? storageClass.toLowerCase().replaceAll('_', '-') : '';
  // `blockPriceInput` preenche toda chave de uso do contrato; o `?? 0` só atende ao tipo.
  return [
    { sku: `s3-storage-${suffix}`, quantity: decimal(usage.storageGb ?? 0), charge: 'variable' },
    {
      sku: `s3-requests-put-${suffix}`,
      quantity: decimal(usage.putRequestsPerMonth ?? 0),
      charge: 'variable',
    },
    {
      sku: `s3-requests-get-${suffix}`,
      quantity: decimal(usage.getRequestsPerMonth ?? 0),
      charge: 'variable',
    },
  ];
};
