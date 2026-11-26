import type { BlockPricer } from '../blockContract';

/** `aws.lambda`: preço provisório, sem cobranças. As regras reais chegam na #30. */
export const priceLambda: BlockPricer = () => [];
