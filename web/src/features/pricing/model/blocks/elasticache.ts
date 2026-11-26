import type { BlockPricer } from '../blockContract';

/** `aws.elasticache`: preço provisório, sem cobranças. As regras reais chegam na #35. */
export const priceElastiCache: BlockPricer = () => [];
