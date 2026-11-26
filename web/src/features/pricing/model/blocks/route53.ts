import type { BlockPricer } from '../blockContract';

/** `aws.route53`: preço provisório, sem cobranças. As regras reais chegam na #38. */
export const priceRoute53: BlockPricer = () => [];
