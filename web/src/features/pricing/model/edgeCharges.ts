import { CLIENT_NODE_ID, type Block, type Edge } from '../../../shared/lib/design';
import { decimal, mul } from '../../../shared/lib/money';
import type { BlockDefinition } from './blockContract';
import { blockPriceInput } from './blockInput';
import { EDGE_KIND_DEFINITIONS } from './blockRegistry';
import type { ServiceCharge } from './rating';

/**
 * SKUs dos custos de aresta (PRD F13), com o serviço do catálogo de cada um. A aresta cobra o
 * mesmo SKU que o bloco de destino usa para o volume informado nele (NAT Gateway, CloudWatch):
 * franquia e faixas são da conta, então bloco e arestas as dividem.
 */
export const EDGE_SKUS = {
  /** Saída da região para a internet (S3, ALB, EC2): faixas e franquia somadas entre os serviços. */
  internetOut: { service: 'data-transfer', sku: 'data-transfer-internet-out' },
  /** Saída das bordas do CloudFront para a internet: tabela e franquia próprias. */
  cloudFrontOut: { service: 'cloudfront', sku: 'cloudfront-data-transfer-out' },
  /** Tráfego entre zonas de disponibilidade, por GB em cada direção. */
  interAz: { service: 'data-transfer', sku: 'data-transfer-inter-az' },
  /** GB processado pelo NAT Gateway. */
  natProcessed: { service: 'nat-gateway', sku: 'nat-gateway-data-processed' },
  /** Ingestão de logs no CloudWatch. */
  logsIngested: { service: 'cloudwatch', sku: 'cloudwatch-logs-ingestion' },
} as const;

/** Cada GB entre zonas é cobrado na saída de uma zona e na entrada da outra. */
const DIRECTIONS = decimal(2);

interface EdgeEnd {
  readonly type: string;
  readonly az?: string | number | boolean;
}

/**
 * O que uma aresta cobra no mês, sem o valor em dólar: quantidade bruta de cada SKU, para o
 * `createRater` aplicar franquia e faixas. Lista vazia: a aresta não custa. `undefined`: a aresta
 * está fora do contrato (`contracts/edges.json`) e não tem preço: par origem/destino não aceito
 * para o tipo, ponta de tipo desconhecido ou com atributo fora das opções.
 *
 * - `runs-on`: sem custo.
 * - `logs`: ingestão no CloudWatch, `gbPerMonth`.
 * - `data` para `client`: saída para a internet, pela tabela do CloudFront se a origem é
 *   CloudFront e pela da região nos demais.
 * - `data` para um NAT Gateway: GB processado.
 * - `data` entre blocos com `az` diferente: `gbPerMonth` em cada direção (2 × `gbPerMonth`).
 *   Mesma zona, ou alguma ponta sem `az`: sem custo.
 *
 * O uso é o efetivo (override vence), ajustado ao contrato como o dos blocos.
 */
export function edgeCharges(
  edge: Edge,
  blockOf: (id: string) => Block | undefined,
  definitionOf: (type: string) => BlockDefinition | undefined,
): readonly ServiceCharge[] | undefined {
  const endOf = (id: string): EdgeEnd | undefined => {
    const block = blockOf(id);
    const definition = block && definitionOf(block.type);
    const input = definition && blockPriceInput(definition, block);
    return input && { type: block.type, az: input.attributes.az };
  };
  const source = endOf(edge.source);
  const target = edge.target === CLIENT_NODE_ID ? { type: CLIENT_NODE_ID } : endOf(edge.target);
  const contract = EDGE_KIND_DEFINITIONS.find((definition) => definition.kind === edge.kind);
  if (source === undefined || target === undefined || contract === undefined) return undefined;
  const accepted = contract.pairs.some(
    (pair) =>
      pair.sources.some((type) => type === source.type) &&
      pair.targets.some((type) => type === target.type),
  );
  if (!accepted) return undefined;

  const usage = blockPriceInput(
    { attributes: [], usage: contract.usage },
    { attributes: {}, usage: edge.usage, overrides: edge.overrides },
  )?.usage;
  const gb = decimal(usage?.gbPerMonth ?? 0);
  const charge = (
    { service, sku }: (typeof EDGE_SKUS)[keyof typeof EDGE_SKUS],
    quantity = gb,
  ): ServiceCharge[] => [{ service, sku, quantity, charge: 'variable' }];

  if (edge.kind === 'runs-on') return [];
  if (edge.kind === 'logs') return charge(EDGE_SKUS.logsIngested);
  if (target.type === CLIENT_NODE_ID) {
    return charge(
      source.type === 'aws.cloudfront' ? EDGE_SKUS.cloudFrontOut : EDGE_SKUS.internetOut,
    );
  }
  if (target.type === 'aws.nat-gateway') return charge(EDGE_SKUS.natProcessed);
  const crossesZones =
    source.az !== undefined && target.az !== undefined && source.az !== target.az;
  return crossesZones ? charge(EDGE_SKUS.interAz, mul(gb, DIRECTIONS)) : [];
}
