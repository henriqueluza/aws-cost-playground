import type { BlockPricer } from '../blockContract';

/** `aws.alb`: preço provisório, sem cobranças. As regras reais chegam na #36. */
export const priceAlb: BlockPricer = () => [];
