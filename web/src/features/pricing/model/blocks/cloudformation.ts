import type { BlockPricer } from '../blockContract';

/** `aws.cloudformation`: preço provisório, sem cobranças. As regras reais chegam na #41. */
export const priceCloudFormation: BlockPricer = () => [];
