import type { BlockPricer } from '../blockContract';

/** `aws.secrets-manager`: preço provisório, sem cobranças. As regras reais chegam na #39. */
export const priceSecretsManager: BlockPricer = () => [];
