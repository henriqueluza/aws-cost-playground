import { decimal, mul } from '../../../../shared/lib/money';
import type { BlockPricer } from '../blockContract';

/** Horas de um mês na calculadora da AWS: o nó fica ligado o mês todo (100% de utilização). */
const HOURS_PER_MONTH = decimal(730);
/** Motores e tipos de nó do contrato, na ordem de `contracts/blocks.json`. */
const ENGINES = ['redis', 'memcached'] as const;
const NODE_TYPES = [
  'cache.t3.micro',
  'cache.t3.small',
  'cache.t3.medium',
  'cache.t4g.micro',
  'cache.t4g.small',
  'cache.t4g.medium',
  'cache.m5.large',
  'cache.r5.large',
] as const;

/** Igualdade estrita contra a lista fechada: chave do protótipo (ex.: `toString`) não casa. */
const isOneOf = <T>(options: readonly T[], value: unknown): value is T =>
  options.some((option) => option === value);

/**
 * `aws.elasticache`: nós on-demand do motor e do tipo do bloco (Redis OSS ou Memcached), em
 * nó-hora (nós × 730 h, custo fixo). Réplicas e shards entram em `nodeCount`. A zona (`az`) não
 * muda o preço do nó; tráfego entre zonas é de aresta. Os preços ficam no catálogo, não aqui.
 * Fora de escopo: Serverless, Valkey, nós reservados, backup, data tiering, Global Datastore,
 * Extended Support e a franquia de 12 meses.
 * Entrada fora do contrato (que `blockPriceInput` já recusa) lança `RangeError`, nunca custo zero.
 */
export const priceElastiCache: BlockPricer = ({ attributes, usage }) => {
  const { engine, nodeType } = attributes;
  const { nodeCount } = usage;
  if (!isOneOf(ENGINES, engine) || !isOneOf(NODE_TYPES, nodeType)) {
    throw new RangeError('aws.elasticache: motor ou tipo de nó fora do contrato');
  }
  if (nodeCount === undefined) throw new RangeError('aws.elasticache: uso fora do contrato');
  const quantity = mul(decimal(nodeCount), HOURS_PER_MONTH);
  return [{ sku: `elasticache-${engine}-${nodeType}`, quantity, charge: 'fixed' }];
};
