import type { BlockPricer } from '../blockContract';

/** `aws.sqs`: preço provisório, sem cobranças. As regras reais chegam na #30. */
export const priceSqs: BlockPricer = () => [];
