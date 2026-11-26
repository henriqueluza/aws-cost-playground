import type { BlockPricer } from '../blockContract';

/** `aws.s3`: preço provisório, sem cobranças. As regras reais chegam na #31. */
export const priceS3: BlockPricer = () => [];
