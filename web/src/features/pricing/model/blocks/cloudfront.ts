import type { BlockPricer } from '../blockContract';

/** `aws.cloudfront`: preço provisório, sem cobranças. As regras reais chegam na #31. */
export const priceCloudFront: BlockPricer = () => [];
