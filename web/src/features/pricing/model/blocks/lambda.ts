import { decimal, div, mul } from '../../../../shared/lib/money';
import type { BlockPricer } from '../blockContract';

/** Sufixo do SKU por arquitetura do contrato. `Map`: chave do protótipo não casa. */
const ARCHITECTURE_SUFFIX: ReadonlyMap<unknown, string> = new Map([
  ['x86_64', 'x86'],
  ['arm64', 'arm64'],
]);
/** ms × MB em um GB-s: 1.000 ms por segundo × 1.024 MB por GB. */
const MS_MB_PER_GB_SECOND = decimal(1024000);

/**
 * `aws.lambda`: requisições e duração em GB-s da arquitetura do bloco, emitidas mesmo com uso
 * zero. GB-s = requisições × ms / 1.000 × MB / 1.024, exato: a memória é múltiplo de 128.
 * Regra da AWS, aplicada pelo catálogo: a franquia mensal de requisições e a de GB-s são divididas
 * entre x86 e arm64 (`pool`); as faixas de duração são de cada arquitetura.
 * Fora de escopo: armazenamento efêmero, provisioned concurrency, Lambda@Edge e SnapStart.
 * Entrada fora do contrato (que `blockPriceInput` já recusa) lança `RangeError`, nunca custo zero.
 */
export const priceLambda: BlockPricer = ({ attributes, usage }) => {
  const suffix = ARCHITECTURE_SUFFIX.get(attributes.architecture);
  const { memoryMb } = attributes;
  const { requestsPerMonth, avgDurationMs } = usage;
  if (suffix === undefined) throw new RangeError('aws.lambda: arquitetura fora do contrato');
  if (typeof memoryMb !== 'number') throw new RangeError('aws.lambda: memória fora do contrato');
  if (requestsPerMonth === undefined || avgDurationMs === undefined) {
    throw new RangeError('aws.lambda: uso fora do contrato');
  }
  const requests = decimal(requestsPerMonth);
  const gbSeconds = div(
    mul(mul(requests, decimal(avgDurationMs)), decimal(memoryMb)),
    MS_MB_PER_GB_SECOND,
  );
  return [
    { sku: `lambda-requests-${suffix}`, quantity: requests, charge: 'variable' },
    { sku: `lambda-duration-${suffix}`, quantity: gbSeconds, charge: 'variable' },
  ];
};
