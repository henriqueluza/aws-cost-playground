import { describe, expect, it } from 'vitest';
import { exportDesign } from '../../application/exportDesign';
import { attrs, block, design, generate, labels, named } from '../../test/generatorKit';
import { INJECTION_PAYLOADS } from '../../test/injectionPayloads';

const cache = (name: string, attributes = {}, values = {}, label = name) =>
  block(`blk_${name}`, 'aws.elasticache', attributes, values, label);
const zone = (letter: string) => `format("%s%s", var.aws_region, "${letter}")`;

describe('gerador de ElastiCache', () => {
  it('Redis vira grupo de replicação criptografado em repouso e em trânsito, com os nós do design', () => {
    const nodes = generate(
      design([
        cache('cache', { engine: 'redis', nodeType: 'cache.t3.small', az: 'b' }, { nodeCount: 3 }),
      ]),
    );
    expect(labels(nodes, 'aws_elasticache_cluster')).toEqual([]);
    expect(attrs(named(nodes, 'aws_elasticache_replication_group', 'cache'))).toEqual({
      replication_group_id: '"cache-1"',
      description: '"Cache Redis do design"',
      engine: '"redis"',
      node_type: '"cache.t3.small"',
      port: '6379',
      num_cache_clusters: '3',
      preferred_cache_cluster_azs: `[${zone('b')}, ${zone('a')}, ${zone('b')}]`,
      automatic_failover_enabled: 'true',
      subnet_group_name: 'aws_elasticache_subnet_group.cache.name',
      security_group_ids: '[aws_security_group.cache.id]',
      at_rest_encryption_enabled: 'true',
      transit_encryption_enabled: 'true',
    });
    expect(attrs(named(nodes, 'aws_elasticache_subnet_group', 'cache'))).toEqual({
      name: '"cache-1"',
      subnet_ids: '[aws_subnet.private_a.id, aws_subnet.private_b.id]',
    });
  });

  it('Redis de um nó não liga failover; acima de 6 nós usa modo cluster', () => {
    const nodes = generate(design([cache('um'), cache('muitos', {}, { nodeCount: 9 })]));
    expect(attrs(named(nodes, 'aws_elasticache_replication_group', 'um'))).toMatchObject({
      replication_group_id: '"cache-2"',
      node_type: '"cache.t3.micro"',
      num_cache_clusters: '1',
      preferred_cache_cluster_azs: `[${zone('a')}]`,
      automatic_failover_enabled: 'false',
    });
    const many = attrs(named(nodes, 'aws_elasticache_replication_group', 'muitos'));
    expect(many).toMatchObject({
      cluster_mode: '"enabled"',
      num_node_groups: '9',
      replicas_per_node_group: '0',
      automatic_failover_enabled: 'true',
      at_rest_encryption_enabled: 'true',
      transit_encryption_enabled: 'true',
    });
    expect(Object.keys(many)).not.toContain('num_cache_clusters');
  });

  it('Memcached vira cluster, sem os argumentos que só o Redis tem', () => {
    const nodes = generate(
      design([
        cache('um', { engine: 'memcached', nodeType: 'cache.m5.large', az: 'c' }),
        cache('varios', { engine: 'memcached' }, { nodeCount: 4 }),
      ]),
    );
    expect(labels(nodes, 'aws_elasticache_replication_group')).toEqual([]);
    expect(attrs(named(nodes, 'aws_elasticache_cluster', 'um'))).toEqual({
      cluster_id: '"cache-1"',
      engine: '"memcached"',
      node_type: '"cache.m5.large"',
      port: '11211',
      num_cache_nodes: '1',
      availability_zone: zone('c'),
      subnet_group_name: 'aws_elasticache_subnet_group.um.name',
      security_group_ids: '[aws_security_group.cache.id]',
      transit_encryption_enabled: 'true',
    });
    expect(attrs(named(nodes, 'aws_elasticache_cluster', 'varios'))).toMatchObject({
      num_cache_nodes: '4',
      az_mode: '"cross-az"',
    });
  });

  it('sozinho no design também emite a rede, com duas zonas privadas', () => {
    const nodes = generate(design([cache('c', { az: 'c' })]));
    expect(labels(nodes, 'aws_vpc')).toEqual(['main']);
    expect(labels(nodes, 'aws_security_group')).toEqual(['cache']);
    expect(attrs(named(nodes, 'aws_elasticache_subnet_group', 'c')).subnet_ids).toBe(
      '[aws_subnet.private_a.id, aws_subnet.private_c.id]',
    );
  });

  it('atributo fora do contrato recusa o bloco, e nenhum token de autenticação é escrito', () => {
    const document = design([cache('ok'), cache('ruim', { engine: 'valkey' })]);
    expect(labels(generate(document), 'aws_elasticache_replication_group')).toEqual(['ok']);
    const result = exportDesign(document);
    const text = result.ok ? (result.files[0]?.content ?? '') : '';
    expect(text).toContain('# - aws.elasticache "ruim": atributo fora das opções do contrato');
    expect(text).not.toMatch(/auth_token|password/);
  });

  it.each(INJECTION_PAYLOADS)('rótulo com a carga "%s" não chega a nenhum valor', (_n, p) => {
    const values = (label: string) =>
      generate(design([cache('a', {}, {}, label), cache('b', { engine: 'memcached' }, {}, label)]))
        .flatMap((node) => (node.kind === 'block' ? Object.entries(attrs(node)) : []))
        .map(
          ([name, value]) =>
            `${name}=${value.replace(/(subnet_group)\.[a-z][a-z0-9_]*\./, '$1.N.')}`,
        );
    expect(values(p.slice(0, 80))).toEqual(values('ok'));
  });
});
