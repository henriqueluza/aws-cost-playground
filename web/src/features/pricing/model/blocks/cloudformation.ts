import { zeroCostPricer } from '../zeroCost';

/**
 * `aws.cloudformation`: custo zero. A AWS não cobra pelas stacks de recursos da própria AWS; o
 * custo é dos recursos criados, que são os outros blocos do design. Extensões de terceiros
 * (hooks e tipos fora de `AWS::*`), que têm cobrança por operação, não são modeladas. Não tem
 * SKU nem arquivo de preço.
 */
export const priceCloudFormation = zeroCostPricer({ kind: 'no-direct-cost' });
