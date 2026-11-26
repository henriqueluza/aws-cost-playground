import type { BlockGenerator, GeneratorInput } from '../generator';
import { hcl, type HclNode } from '../hcl';
import {
  blockAz,
  designAzs,
  ordinalId,
  securityGroupId,
  subnetIds,
  withNetwork,
  zoneName,
} from './network';

/** Limites da AWS: nós por grupo de replicação sem modo cluster, e nós por cluster de Memcached. */
const MAX_REDIS_NODES = 6;
const MAX_MEMCACHED_NODES = 40;

/** Grupo de replicação Redis: criptografia em repouso e em trânsito e os nós do design. */
function redis(input: GeneratorInput, id: string, shared: readonly HclNode[]): HclNode[] {
  const { block } = input;
  const nodes = block.usage.nodeCount ?? 1;
  // Um nó por zona, a partir da zona do bloco e dando a volta nas zonas do design.
  const azs = designAzs(input.blocks);
  const start = azs.indexOf(blockAz(block));
  const zoneOf = (i: number) => zoneName(azs[(start + i) % azs.length] ?? 'a');
  const sizing =
    nodes <= MAX_REDIS_NODES
      ? [
          hcl.attr('num_cache_clusters', hcl.number(nodes)),
          hcl.attr(
            'preferred_cache_cluster_azs',
            hcl.list(Array.from({ length: nodes }, (_, i) => zoneOf(i))),
          ),
          hcl.attr('automatic_failover_enabled', hcl.bool(nodes > 1)),
        ]
      : [
          // Modo cluster: grupo de parâmetros padrão com `cluster-enabled`, que é preso à versão 7.
          hcl.attr('engine_version', hcl.string('7.1')),
          hcl.attr('parameter_group_name', hcl.string('default.redis7.cluster.on')),
          hcl.attr('num_node_groups', hcl.number(nodes)),
          hcl.attr('replicas_per_node_group', hcl.number(0)),
          hcl.attr('automatic_failover_enabled', hcl.bool(true)),
        ];
  return [
    ...(nodes > MAX_REDIS_NODES
      ? [hcl.comment('Mais de 6 nós: modo cluster, com um nó por shard. Confira antes de aplicar.')]
      : []),
    hcl.block(
      'resource',
      ['aws_elasticache_replication_group', block.name],
      [
        hcl.attr('replication_group_id', hcl.string(id)),
        hcl.attr('description', hcl.string('Cache Redis do design')),
        hcl.attr('engine', hcl.string('redis')),
        hcl.attr('node_type', hcl.string(String(block.attributes.nodeType))),
        hcl.attr('port', hcl.number(6379)),
        ...sizing,
        ...shared,
        hcl.attr('at_rest_encryption_enabled', hcl.bool(true)),
        hcl.attr('transit_encryption_enabled', hcl.bool(true)),
      ],
    ),
  ];
}

/** Cluster Memcached: o motor não tem criptografia em repouso nem réplica; só a em trânsito. */
function memcached(input: GeneratorInput, id: string, shared: readonly HclNode[]): HclNode[] {
  const { block } = input;
  const nodes = block.usage.nodeCount ?? 1;
  return [
    hcl.comment('O Memcached não oferece criptografia em repouso; a em trânsito fica ligada.'),
    ...(nodes > MAX_MEMCACHED_NODES
      ? [hcl.comment('A AWS aceita até 40 nós por cluster de Memcached: divida antes de aplicar.')]
      : []),
    hcl.block(
      'resource',
      ['aws_elasticache_cluster', block.name],
      [
        hcl.attr('cluster_id', hcl.string(id)),
        hcl.attr('engine', hcl.string('memcached')),
        hcl.attr('node_type', hcl.string(String(block.attributes.nodeType))),
        hcl.attr('port', hcl.number(11211)),
        hcl.attr('num_cache_nodes', hcl.number(nodes)),
        ...(nodes > 1
          ? [hcl.attr('az_mode', hcl.string('cross-az'))]
          : [hcl.attr('availability_zone', zoneName(blockAz(block)))]),
        ...shared,
        hcl.attr('transit_encryption_enabled', hcl.bool(true)),
      ],
    ),
  ];
}

/** ElastiCache em sub-redes privadas: o recurso certo para cada motor, com o seu grupo de sub-redes. */
export const elasticache: BlockGenerator = (input) => {
  const { block } = input;
  const id = ordinalId(input, 'cache');
  const shared = [
    hcl.attr('subnet_group_name', hcl.ref('aws_elasticache_subnet_group', block.name, 'name')),
    hcl.attr('security_group_ids', hcl.list([securityGroupId('cache')])),
  ];
  return withNetwork(input, [
    hcl.block(
      'resource',
      ['aws_elasticache_subnet_group', block.name],
      [
        hcl.attr('name', hcl.string(id)),
        hcl.attr('subnet_ids', subnetIds('private', input.blocks)),
      ],
    ),
    ...(block.attributes.engine === 'memcached' ? memcached : redis)(input, id, shared),
  ]);
};
