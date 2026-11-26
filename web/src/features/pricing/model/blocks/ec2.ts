import type { BlockPricer } from '../blockContract';

/** `aws.ec2`: preço provisório, sem cobranças. As regras reais chegam na #33. */
export const priceEc2: BlockPricer = () => [];
