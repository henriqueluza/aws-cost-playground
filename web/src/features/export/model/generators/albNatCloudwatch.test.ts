import { describe, expect, it } from 'vitest';
import { exportDesign } from '../../application/exportDesign';
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
import { INJECTION_PAYLOADS } from '../../test/injectionPayloads';
import { renderHcl } from '../hcl';

const alb = (id: string, label = id) => block(id, 'aws.alb', {}, {}, label);
const nat = (id: string, label = id) => block(id, 'aws.nat-gateway', {}, {}, label);
const logs = (id: string, label = id) => block(id, 'aws.cloudwatch', {}, {}, label);
const ec2 = (id: string, az: string, instanceCount = 1) =>
  block(id, 'aws.ec2', { az }, { instanceCount });
const mainTf = (document: unknown) => {
  const result = exportDesign(document);
  if (!result.ok) throw new Error(result.error);
  return result.files[0]?.content ?? '';
};

describe('gerador de ALB', () => {
  const document = design(
    [
      alb('blk_lb'),
      ec2('blk_web', 'a', 3),
      ec2('blk_api', 'b'),
      ec2('blk_job', 'b'),
      alb('blk_lb2'),
    ],
    [edge('blk_lb', 'blk_web'), edge('blk_api', 'blk_lb'), edge('blk_lb', 'blk_web', 'logs')],
  );
  const nodes = generate(document);

  it('é público, nas sub-redes públicas, e descarta cabeçalho inválido', () => {
    expect(attrs(named(nodes, 'aws_lb', 'blk_lb'))).toEqual({
      internal: 'false',
      load_balancer_type: '"application"',
      subnets: '[aws_subnet.public_a.id, aws_subnet.public_b.id]',
      security_groups: '[aws_security_group.alb.id]',
      drop_invalid_header_fields: 'true',
    });
    expect(renderHcl(nodes)).not.toContain('access_logs');
  });

  it('atende HTTPS com o certificado da variável sem padrão, e a 80 só redireciona', () => {
    expect(attrs(named(nodes, 'aws_lb_listener', 'blk_lb_https'))).toEqual({
      load_balancer_arn: 'aws_lb.blk_lb.arn',
      port: '443',
      protocol: '"HTTPS"',
      ssl_policy: '"ELBSecurityPolicy-TLS13-1-2-2021-06"',
      certificate_arn: 'var.certificate_arn',
      'default_action.type': '"forward"',
      'default_action.target_group_arn': 'aws_lb_target_group.blk_lb.arn',
    });
    expect(attrs(named(nodes, 'aws_lb_listener', 'blk_lb_http'))).toEqual({
      load_balancer_arn: 'aws_lb.blk_lb.arn',
      port: '80',
      protocol: '"HTTP"',
      'default_action.type': '"redirect"',
      'default_action.redirect.port': '"443"',
      'default_action.redirect.protocol': '"HTTPS"',
      'default_action.redirect.status_code': '"HTTP_301"',
    });
    const variables = blocksOf(nodes, 'certificate_arn', 'variable');
    expect(variables).toHaveLength(1);
    expect(Object.keys(attrs(variables[0] ?? named(nodes, 'x', 'x')))).toEqual([
      'description',
      'type',
    ]);
    expect(mainTf(document)).not.toMatch(/arn:aws/);
  });

  it('anexa ao grupo de destino só as instâncias ligadas por aresta de dados, todas as do bloco', () => {
    expect(attrs(named(nodes, 'aws_lb_target_group', 'blk_lb'))).toEqual({
      port: '80',
      protocol: '"HTTP"',
      vpc_id: 'aws_vpc.main.id',
      'health_check.path': '"/"',
    });
    expect(labels(nodes, 'aws_lb_target_group_attachment')).toEqual(['blk_lb_1', 'blk_lb_2']);
    expect(attrs(named(nodes, 'aws_lb_target_group_attachment', 'blk_lb_1'))).toEqual({
      count: '1',
      target_group_arn: 'aws_lb_target_group.blk_lb.arn',
      target_id: 'aws_instance.blk_api[count.index].id',
      port: '80',
    });
    expect(attrs(named(nodes, 'aws_lb_target_group_attachment', 'blk_lb_2'))).toMatchObject({
      count: '3',
      target_id: 'aws_instance.blk_web[count.index].id',
    });
  });

  it('sozinho no design emite a rede, com duas zonas públicas', () => {
    const alone = generate(design([alb('blk_lb')]));
    expect(labels(alone, 'aws_vpc')).toEqual(['main']);
    expect(attrs(named(alone, 'aws_lb', 'blk_lb')).subnets).toBe(
      '[aws_subnet.public_a.id, aws_subnet.public_b.id]',
    );
    expect(labels(alone, 'aws_lb_target_group_attachment')).toEqual([]);
  });
});

describe('bordas de ALB e NAT Gateway', () => {
  it('a mesma instância ligada por duas arestas entra uma vez; o segundo ALB não herda anexos', () => {
    const found = generate(
      design(
        [alb('blk_lb'), alb('blk_lb2'), ec2('blk_web', 'a')],
        [edge('blk_lb', 'blk_web'), edge('blk_web', 'blk_lb')],
      ),
    );
    expect(labels(found, 'aws_lb_target_group_attachment')).toEqual(['blk_lb_1']);
    expect(blocksOf(found, 'certificate_arn', 'variable')).toHaveLength(1);
    expect(labels(found, 'aws_lb')).toEqual(['blk_lb', 'blk_lb2']);
  });

  it('nome de 48 caracteres: os rótulos derivados cabem no limite do identificador', () => {
    const long = 'n'.repeat(48);
    const document = design(
      [alb('blk_1', long), nat('blk_2', long), block('blk_3', 'aws.ec2', {}, {}, long)],
      [edge('blk_1', 'blk_3')],
    );
    const found = generate(document);
    expect(labels(found, 'aws_lb_listener')).toEqual([`${long}_https`, `${long}_http`]);
    expect(labels(found, 'aws_lb_target_group_attachment')).toEqual([`${long}_1`]);
    expect(labels(found, 'aws_route')).toContain(`${'n'.repeat(46)}_2_b`);
    for (const node of blocksOf(found)) expect(node.labels[1]?.length).toBeLessThanOrEqual(64);
    expect(exportDesign(document).ok).toBe(true);
  });

  it.each([
    [1, ['blk_n1_a', 'blk_n1_b', 'blk_n1_c']],
    [3, ['blk_n1_a', 'blk_n2_b', 'blk_n3_c']],
    [4, ['blk_n1_a', 'blk_n2_b', 'blk_n3_c']],
  ])('%i NAT Gateway(s) em três zonas repartem as rotas privadas', (count, routes) => {
    const zones = ['a', 'b', 'c'].map((az) => ec2(`blk_web_${az}`, az));
    const gateways = Array.from({ length: count }, (_, i) => nat(`blk_n${i + 1}`));
    const found = generate(design([...zones, ...gateways]));
    expect(labels(found, 'aws_route')).toEqual(['public_internet', ...routes]);
    expect(found.some((n) => n.kind === 'comment' && n.text.includes('mais NAT Gateways'))).toBe(
      count === 4,
    );
  });
});

describe('gerador de NAT Gateway', () => {
  it('fica numa sub-rede pública, com Elastic IP, e recebe a rota padrão das privadas', () => {
    const nodes = generate(design([nat('blk_nat'), ec2('blk_web', 'a'), ec2('blk_api', 'c')]));
    expect(attrs(named(nodes, 'aws_eip', 'blk_nat'))).toEqual({ domain: '"vpc"' });
    expect(attrs(named(nodes, 'aws_nat_gateway', 'blk_nat'))).toEqual({
      allocation_id: 'aws_eip.blk_nat.id',
      subnet_id: 'aws_subnet.public_a.id',
      depends_on: '[aws_internet_gateway.main]',
    });
    expect(labels(nodes, 'aws_route')).toEqual(['public_internet', 'blk_nat_a', 'blk_nat_c']);
    expect(attrs(named(nodes, 'aws_route', 'blk_nat_c'))).toEqual({
      route_table_id: 'aws_route_table.private_c.id',
      destination_cidr_block: '"0.0.0.0/0"',
      nat_gateway_id: 'aws_nat_gateway.blk_nat.id',
    });
  });

  it('vários blocos se repartem pelas zonas; o que sobra não recebe rota', () => {
    const nodes = generate(design([nat('blk_n1'), nat('blk_n2'), nat('blk_n3')]));
    expect(labels(nodes, 'aws_vpc')).toEqual(['main']);
    expect(labels(nodes, 'aws_nat_gateway')).toEqual(['blk_n1', 'blk_n2', 'blk_n3']);
    expect(labels(nodes, 'aws_route')).toEqual(['public_internet', 'blk_n1_a', 'blk_n2_b']);
    expect(attrs(named(nodes, 'aws_nat_gateway', 'blk_n2')).subnet_id).toBe(
      'aws_subnet.public_b.id',
    );
    expect(attrs(named(nodes, 'aws_nat_gateway', 'blk_n3')).subnet_id).toBe(
      'aws_subnet.public_a.id',
    );
  });
});

describe('gerador de CloudWatch', () => {
  it('gera só o log group, com retenção, e não precisa da rede', () => {
    const document = design(
      [logs('blk_logs'), block('blk_db', 'aws.rds')],
      [edge('blk_db', 'blk_logs', 'logs')],
    );
    const group = generate(design([logs('blk_logs')]));
    expect(blocksOf(group).map((node) => node.labels[0])).toEqual(['aws_cloudwatch_log_group']);
    expect(attrs(named(group, 'aws_cloudwatch_log_group', 'blk_logs'))).toEqual({
      name: '"/aws-cost-playground/blk_logs"',
      retention_in_days: '30',
    });
    expect(mainTf(document)).toContain('# Origens dos logs: aws.rds (blk_db).');
    expect(mainTf(document)).not.toMatch(/aws_cloudwatch_metric_alarm|aws_kms_key/);
    const refused = block('blk_db', 'aws.rds', { engine: 'oracle' });
    const text = mainTf(design([logs('blk_logs'), refused], [edge('blk_db', 'blk_logs', 'logs')]));
    expect(text).not.toContain('Origens dos logs');
  });
});

describe('rótulos de ALB, NAT Gateway e CloudWatch', () => {
  it.each(INJECTION_PAYLOADS)('a carga "%s" não muda a forma nem chega a um valor', (_n, p) => {
    const build = (label: string) =>
      generate(design([alb('blk_1', label), nat('blk_2', label), logs('blk_3', label)]));
    const shape = (nodes: ReturnType<typeof generate>) =>
      blocksOf(nodes).map((node) => [node.labels[0], Object.keys(attrs(node))]);
    const evil = build(p.slice(0, 80));
    expect(shape(evil)).toEqual(shape(build('ok')));
    for (const node of blocksOf(evil)) expect(node.labels[1]).toMatch(/^[a-z][a-z0-9_]{0,63}$/);
    const code = renderHcl(evil.filter((node) => node.kind !== 'comment'));
    expect(code).toMatch(/^[\n -~]*$/);
    expect(code).not.toMatch(/\$\{|%\{|"aws_iam_user"|file\(/);
  });
});
