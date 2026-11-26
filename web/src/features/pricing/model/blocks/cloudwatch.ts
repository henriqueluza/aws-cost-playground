import type { BlockPricer } from '../blockContract';

/** `aws.cloudwatch`: preço provisório, sem cobranças. As regras reais chegam na #37. */
export const priceCloudWatch: BlockPricer = () => [];
