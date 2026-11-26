import { zeroCostPricer } from '../zeroCost';

/**
 * `aws.iam`: custo zero. A AWS não cobra por usuários, grupos, papéis nem políticas do IAM, que é
 * o que o bloco representa. Não tem SKU nem arquivo de preço.
 */
export const priceIam = zeroCostPricer({ kind: 'no-direct-cost' });
