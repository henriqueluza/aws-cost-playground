import { describe, expect, it } from 'vitest';
import appClassico from '../../../../../contracts/scenarios/app-classico.json';
import { designDocumentSchema } from '../../../shared/lib/design';
import { attrs, blocksOf, generate, labels, named } from '../test/generatorKit';
import { exportDesign } from './exportDesign';

const result = exportDesign(appClassico);
const text = result.ok ? (result.files[0]?.content ?? '') : '';
const nodes = generate(designDocumentSchema.parse(appClassico));

describe('export do cenário app-classico', () => {
  it('nenhum dos seis blocos em VPC fica como não exportado', () => {
    expect(result.ok).toBe(true);
    expect(text).not.toMatch(/^# - aws\.(ec2|rds|elasticache|alb|nat-gateway|cloudwatch) /m);
    expect(text).toMatch(/^# Blocos exportados: [7-9] de 9\./m);
  });

  it('tem uma rede só, nas zonas a e b, e cada bloco no seu lugar', () => {
    expect(labels(nodes, 'aws_vpc')).toEqual(['main']);
    expect(labels(nodes, 'aws_subnet')).toEqual(['public_a', 'private_a', 'public_b', 'private_b']);
    expect(labels(nodes, 'aws_security_group')).toEqual(['alb', 'app', 'db', 'cache']);
    expect(attrs(named(nodes, 'aws_instance', 'web_zona_a')).subnet_id).toBe(
      'aws_subnet.private_a.id',
    );
    expect(attrs(named(nodes, 'aws_instance', 'web_zona_b')).subnet_id).toBe(
      'aws_subnet.private_b.id',
    );
    expect(attrs(named(nodes, 'aws_db_instance', 'banco'))).toMatchObject({
      engine: '"postgres"',
      instance_class: '"db.t3.medium"',
      multi_az: 'true',
      allocated_storage: '100',
      publicly_accessible: 'false',
    });
    expect(attrs(named(nodes, 'aws_elasticache_replication_group', 'cache'))).toMatchObject({
      node_type: '"cache.t3.small"',
      num_cache_clusters: '2',
    });
    expect(labels(nodes, 'aws_lb_target_group_attachment')).toEqual([
      'balanceador_1',
      'balanceador_2',
    ]);
    expect(labels(nodes, 'aws_route')).toEqual([
      'public_internet',
      'saida_para_a_internet_a',
      'saida_para_a_internet_b',
    ]);
    expect(labels(nodes, 'aws_cloudwatch_log_group')).toEqual(['logs_e_metricas']);
  });

  it('as regras seguem as arestas, e banco e cache não têm CIDR nem senha literal', () => {
    const rules = blocksOf(nodes).filter((node) => node.labels[0]?.includes('_security_group_'));
    expect(rules.map((rule) => rule.labels[1]).sort()).toEqual([
      'alb_http',
      'alb_https',
      'alb_to_app',
      'app_from_alb',
      'app_https',
      'app_to_cache_redis',
      'app_to_db_postgres',
      'cache_redis_from_app',
      'db_postgres_from_app',
    ]);
    for (const rule of rules) {
      const found = attrs(rule);
      if (/\.(db|cache)\.id$/.test(found.security_group_id ?? '')) {
        expect(found.cidr_ipv4).toBeUndefined();
        expect(found.referenced_security_group_id).toBe('aws_security_group.app.id');
      }
    }
    expect(text).not.toContain('::/0');
    // `http_tokens = "required"` é o IMDSv2 do EC2, não um segredo.
    expect(text).not.toMatch(/^\s*(?!http_tokens\b)\w*(password|secret|token)\w*\s*=\s*"/im);
  });

  it('é determinístico', () => {
    const shuffled = {
      ...appClassico,
      blocks: [...appClassico.blocks].reverse(),
      edges: [...appClassico.edges].reverse(),
    };
    expect(exportDesign(shuffled)).toEqual(result);
  });
});
