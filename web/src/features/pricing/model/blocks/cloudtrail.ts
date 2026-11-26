import type { BlockPricer } from '../blockContract';

/** `aws.cloudtrail`: preço provisório, sem cobranças. As regras reais chegam na #40. */
export const priceCloudTrail: BlockPricer = () => [];
