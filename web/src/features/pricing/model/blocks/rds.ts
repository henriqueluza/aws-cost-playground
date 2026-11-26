import type { BlockPricer } from '../blockContract';

/** `aws.rds`: preço provisório, sem cobranças. As regras reais chegam na #34. */
export const priceRds: BlockPricer = () => [];
