import type { BlockPricer } from '../blockContract';

/** `aws.waf`: preço provisório, sem cobranças. As regras reais chegam na #38. */
export const priceWaf: BlockPricer = () => [];
