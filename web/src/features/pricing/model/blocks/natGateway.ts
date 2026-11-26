import type { BlockPricer } from '../blockContract';

/** `aws.nat-gateway`: preço provisório, sem cobranças. As regras reais chegam na #36. */
export const priceNatGateway: BlockPricer = () => [];
