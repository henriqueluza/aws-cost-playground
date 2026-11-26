import type { BlockPricer } from '../blockContract';

/** `aws.cognito`: preço provisório, sem cobranças. As regras reais chegam na #39. */
export const priceCognito: BlockPricer = () => [];
