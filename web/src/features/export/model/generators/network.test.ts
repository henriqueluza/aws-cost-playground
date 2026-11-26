import { describe, expect, it } from 'vitest';
import {
  attrs,
  block,
  blocksOf,
  design,
  edge,
  generate,
  labels,
  named,
} from '../../test/generatorKit';
import { renderHcl } from '../hcl';

const ec2 = (id: string, az?: string) => block(id, 'aws.ec2', az ? { az } : {});
const rds = (id: string, engine = 'postgres') => block(id, 'aws.rds', { engine });
const cache = (id: string, engine = 'redis') => block(id, 'aws.elasticache', { engine });
const alb = (id: string) => block(id, 'aws.alb');
const rules = (nodes: ReturnType<typeof generate>) => [
  ...blocksOf(nodes, 'aws_vpc_security_group_ingress_rule'),
  ...blocksOf(nodes, 'aws_vpc_security_group_egress_rule'),
];
const ruleNames = (nodes: ReturnType<typeof generate>) => rules(nodes).map((r) => r.labels[1]);

describe('rede compartilhada', () => {
  it.each([2, 3, 6])('emite a VPC uma vez só num design com %i blocos', (n) => {
    const kinds = [ec2, rds, cache, alb, ec2, ec2];
    const nodes = generate(design(kinds.slice(0, n).map((make, i) => make(`blk_${i}`))));
    expect(labels(nodes, 'aws_vpc')).toEqual(['main']);
    expect(labels(nodes, 'aws_internet_gateway')).toEqual(['main']);
    expect(labels(nodes, 'aws_default_security_group')).toEqual(['main']);
    const groups = labels(nodes, 'aws_security_group');
    expect(new Set(groups).size).toBe(groups.length);
    expect(attrs(named(nodes, 'aws_vpc', 'main')).cidr_block).toBe('"10.0.0.0/16"');
  });

  it('quem emite a rede é o primeiro bloco em VPC na ordem do id, qualquer que seja a ordem do documento', () => {
    const blocks = [ec2('blk_b', 'b'), block('blk_0', 'aws.s3'), ec2('blk_a', 'a')];
    const text = renderHcl(generate(design(blocks)));
    expect(renderHcl(generate(design([...blocks].reverse())))).toBe(text);
    expect(text.indexOf('resource "aws_vpc" "main"')).toBeLessThan(text.indexOf('"blk_a"'));
    expect(text.indexOf('"blk_a"')).toBeLessThan(text.indexOf('"blk_b"'));
  });

  it('cria uma sub-rede pública e uma privada por zona usada, com a zona tirada da região', () => {
    const nodes = generate(design([ec2('blk_1', 'a'), ec2('blk_2', 'c'), rds('blk_3')]));
    expect(labels(nodes, 'aws_subnet')).toEqual(['public_a', 'private_a', 'public_c', 'private_c']);
    expect(attrs(named(nodes, 'aws_subnet', 'private_c'))).toEqual({
      vpc_id: 'aws_vpc.main.id',
      cidr_block: '"10.0.12.0/24"',
      availability_zone: 'format("%s%s", var.aws_region, "c")',
      map_public_ip_on_launch: 'false',
    });
    expect(attrs(named(nodes, 'aws_subnet', 'public_a')).cidr_block).toBe('"10.0.0.0/24"');
    for (const subnet of blocksOf(nodes, 'aws_subnet')) {
      expect(attrs(subnet).map_public_ip_on_launch).toBe('false');
    }
    expect(labels(nodes, 'aws_route_table')).toEqual(['public', 'private_a', 'private_c']);
    expect(attrs(named(nodes, 'aws_route_table_association', 'private_c')).route_table_id).toBe(
      'aws_route_table.private_c.id',
    );
  });

  it.each([
    ['uma zona só (b)', [ec2('blk_1', 'b')], ['a', 'b']],
    ['bloco sem zona cai na zona a', [ec2('blk_1')], ['a', 'b']],
    ['zona c só', [ec2('blk_1', 'c'), cache('blk_2')], ['a', 'c']],
    ['três zonas', [ec2('blk_1', 'c'), ec2('blk_2', 'b'), ec2('blk_3', 'a')], ['a', 'b', 'c']],
  ])('garante pelo menos duas zonas: %s', (_name, blocks, zones) => {
    const nodes = generate(design(blocks));
    expect(labels(nodes, 'aws_subnet')).toEqual(
      zones.flatMap((z) => [`public_${z}`, `private_${z}`]),
    );
  });

  it('só a rota pública aponta para o internet gateway; as privadas ficam sem saída', () => {
    const nodes = generate(design([ec2('blk_1')]));
    expect(labels(nodes, 'aws_route')).toEqual(['public_internet']);
    expect(attrs(named(nodes, 'aws_route', 'public_internet')).route_table_id).toBe(
      'aws_route_table.public.id',
    );
  });
});

describe('security groups', () => {
  const full = [alb('blk_1'), ec2('blk_2'), rds('blk_3'), rds('blk_4', 'mysql'), cache('blk_5')];
  const stores = ['aws_security_group.db.id', 'aws_security_group.cache.id'];

  it('sem arestas, vale a cadeia ALB, aplicação, banco e cache, um grupo por papel', () => {
    const nodes = generate(design([...full, cache('blk_6', 'memcached')]));
    expect(labels(nodes, 'aws_security_group')).toEqual(['alb', 'app', 'db', 'cache']);
    expect(ruleNames(nodes).sort()).toEqual(
      [
        'alb_http',
        'alb_https',
        'alb_to_app',
        'app_from_alb',
        'app_https',
        'app_to_cache_memcached',
        'app_to_cache_redis',
        'app_to_db_mysql',
        'app_to_db_postgres',
        'cache_memcached_from_app',
        'cache_redis_from_app',
        'db_mysql_from_app',
        'db_postgres_from_app',
      ].sort(),
    );
    const ports = Object.fromEntries(rules(nodes).map((r) => [r.labels[1], attrs(r).from_port]));
    expect(ports).toMatchObject({
      db_postgres_from_app: '5432',
      db_mysql_from_app: '3306',
      cache_redis_from_app: '6379',
      cache_memcached_from_app: '11211',
      app_from_alb: '80',
    });
  });

  it('nenhuma regra de banco ou de cache tem CIDR: a entrada é só o grupo da aplicação', () => {
    const nodes = generate(design([...full, cache('blk_6', 'memcached')]));
    const ofStores = rules(nodes).filter((r) => stores.includes(attrs(r).security_group_id ?? ''));
    expect(ofStores).toHaveLength(4);
    for (const found of ofStores) {
      expect(found.labels[0]).toBe('aws_vpc_security_group_ingress_rule');
      expect(Object.keys(attrs(found)).filter((key) => key.startsWith('cidr'))).toEqual([]);
      expect(attrs(found).referenced_security_group_id).toBe('aws_security_group.app.id');
    }
    for (const group of blocksOf(nodes, 'aws_security_group')) {
      expect(group.body.every((child) => child.kind === 'attribute')).toBe(true);
    }
  });

  it('a internet só entra no ALB, pelas portas 443 e 80; nada de SSH nem RDP', () => {
    const nodes = generate(design(full));
    const open = blocksOf(nodes, 'aws_vpc_security_group_ingress_rule').filter(
      (r) => attrs(r).cidr_ipv4 !== undefined,
    );
    expect(open.map((r) => [attrs(r).security_group_id, attrs(r).from_port])).toEqual([
      ['aws_security_group.alb.id', '443'],
      ['aws_security_group.alb.id', '80'],
    ]);
    for (const found of rules(nodes)) {
      expect(attrs(found).from_port).toBe(attrs(found).to_port);
      expect(['22', '3389']).not.toContain(attrs(found).from_port);
      expect(attrs(found).ip_protocol).toBe('"tcp"');
    }
    expect(renderHcl(nodes)).not.toContain('::/0');
  });

  it('com arestas, só os pares ligados ganham regra, em qualquer sentido da aresta', () => {
    const linked = generate(design(full, [edge('blk_1', 'blk_2'), edge('blk_5', 'blk_2')]));
    expect(ruleNames(linked)).toEqual(
      expect.arrayContaining(['app_from_alb', 'cache_redis_from_app']),
    );
    expect(ruleNames(linked).filter((name) => name?.includes('db'))).toEqual([]);
  });

  it('aresta do ALB direto para o banco não abre o banco, e aresta de logs não conta', () => {
    const nodes = generate(
      design(full, [edge('blk_1', 'blk_3'), edge('blk_2', 'blk_3', 'logs' as never)]),
    );
    expect(ruleNames(nodes)).toEqual(expect.arrayContaining(['db_postgres_from_app']));
    const direct = generate(design(full, [edge('blk_1', 'blk_3'), edge('blk_1', 'blk_2')]));
    expect(ruleNames(direct).filter((name) => name?.includes('db'))).toEqual([]);
  });

  it('sem ALB a aplicação não tem regra de entrada', () => {
    const nodes = generate(design([ec2('blk_1'), rds('blk_2')]));
    expect(labels(nodes, 'aws_vpc_security_group_ingress_rule')).toEqual(['db_postgres_from_app']);
  });
});
