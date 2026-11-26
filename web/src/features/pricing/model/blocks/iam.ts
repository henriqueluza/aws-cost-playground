import type { BlockPricer } from '../blockContract';

/** `aws.iam`: preço provisório, sem cobranças. As regras reais chegam na #41. */
export const priceIam: BlockPricer = () => [];
