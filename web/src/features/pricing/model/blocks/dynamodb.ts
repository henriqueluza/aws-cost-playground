import type { BlockPricer } from '../blockContract';

/** `aws.dynamodb`: preço provisório, sem cobranças. As regras reais chegam na #32. */
export const priceDynamoDb: BlockPricer = () => [];
