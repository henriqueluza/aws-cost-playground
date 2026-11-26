import type { BlockPricer } from '../blockContract';

/** `aws.ecs`: preço provisório, sem cobranças. As regras reais chegam na #41. */
export const priceEcs: BlockPricer = () => [];
