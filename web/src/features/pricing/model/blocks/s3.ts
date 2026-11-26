import { decimal } from '../../../../shared/lib/money';
import type { BlockPricer } from '../blockContract';

/**
 * `aws.s3`: armazenamento (GB-mês, em faixas no catálogo) e requisições PUT e GET da classe
 * `storageClass`. O sufixo do SKU vem do nome da classe (`STANDARD_IA` → `s3-storage-standard-ia`),
 * sem tabela: classe sem SKU no catálogo (ex.: `GLACIER`) ou que não é texto deixa a cobrança sem
 * preço, e o motor marca o bloco `unavailable`, nunca zero em silêncio.
 * Fora de escopo: recuperação do Standard-IA (GB recuperado), mínimos de 128 KB e de 30 dias do
 * Standard-IA e a franquia de 12 meses (5 GB): o contrato do bloco não tem essas entradas.
 * Uso fora do contrato (que `blockPriceInput` já recusa) lança `RangeError`, nunca custo zero.
 */
export const priceS3: BlockPricer = ({ attributes, usage }) => {
  const { storageClass } = attributes;
  const { storageGb, putRequestsPerMonth: puts, getRequestsPerMonth: gets } = usage;
  if (storageGb === undefined || puts === undefined || gets === undefined) {
    throw new RangeError('aws.s3: uso fora do contrato');
  }
  const suffix =
    typeof storageClass === 'string' ? storageClass.toLowerCase().replaceAll('_', '-') : '';
  return [
    { sku: `s3-storage-${suffix}`, quantity: decimal(storageGb), charge: 'variable' },
    { sku: `s3-requests-put-${suffix}`, quantity: decimal(puts), charge: 'variable' },
    { sku: `s3-requests-get-${suffix}`, quantity: decimal(gets), charge: 'variable' },
  ];
};
