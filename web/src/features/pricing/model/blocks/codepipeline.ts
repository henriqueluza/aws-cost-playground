import type { BlockPricer } from '../blockContract';

/** `aws.codepipeline`: preço provisório, sem cobranças. As regras reais chegam na #40. */
export const priceCodePipeline: BlockPricer = () => [];
