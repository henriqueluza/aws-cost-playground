import type { BlockGenerator, ExportBlock } from '../generator';
import { hcl, type HclNode } from '../hcl';
import { APP_PORT, VPC_ID, securityGroupId, subnetIds, withNetwork } from './network';

const resource = (type: string, name: string, body: readonly HclNode[]): HclNode =>
  hcl.block('resource', [type, name], body);

/** O design não tem domínio: o certificado do listener HTTPS entra por variável, sem padrão. */
const CERTIFICATE = hcl.block(
  'variable',
  ['certificate_arn'],
  [
    hcl.attr('description', hcl.string('ARN do certificado do ACM usado pelos listeners HTTPS.')),
    hcl.attr('type', hcl.ref('string')),
  ],
);

/** Instâncias EC2 ligadas ao ALB por aresta `data`, uma vez cada, na ordem das arestas. */
function targets(links: Parameters<BlockGenerator>[0]['links']): ExportBlock[] {
  const found = new Map<string, ExportBlock>();
  for (const { kind, peer } of links) {
    if (kind === 'data' && peer?.type === 'aws.ec2') found.set(peer.id, peer);
  }
  return [...found.values()];
}

/**
 * ALB público nas sub-redes públicas: HTTPS na 443 com o certificado da variável, a 80 só
 * redireciona, cabeçalhos inválidos são descartados e as instâncias ligadas entram no grupo de
 * destino. Sem logs de acesso: o design não tem o bucket que eles exigem.
 */
export const alb: BlockGenerator = (input) => {
  const { block } = input;
  const arn = (type: string) => hcl.ref(type, block.name, 'arn');
  const listener = (suffix: string, port: number, protocol: string, body: readonly HclNode[]) =>
    resource('aws_lb_listener', `${block.name}_${suffix}`, [
      hcl.attr('load_balancer_arn', arn('aws_lb')),
      hcl.attr('port', hcl.number(port)),
      hcl.attr('protocol', hcl.string(protocol)),
      ...body,
    ]);
  const first = input.blocks.find((candidate) => candidate.type === 'aws.alb');
  return withNetwork(input, [
    ...(first?.id === block.id ? [CERTIFICATE] : []),
    resource('aws_lb', block.name, [
      hcl.attr('internal', hcl.bool(false)),
      hcl.attr('load_balancer_type', hcl.string('application')),
      hcl.attr('subnets', subnetIds('public', input.blocks)),
      hcl.attr('security_groups', hcl.list([securityGroupId('alb')])),
      hcl.attr('drop_invalid_header_fields', hcl.bool(true)),
    ]),
    resource('aws_lb_target_group', block.name, [
      hcl.attr('port', hcl.number(APP_PORT)),
      hcl.attr('protocol', hcl.string('HTTP')),
      hcl.attr('vpc_id', VPC_ID),
      hcl.block('health_check', [], [hcl.attr('path', hcl.string('/'))]),
    ]),
    listener('https', 443, 'HTTPS', [
      hcl.attr('ssl_policy', hcl.string('ELBSecurityPolicy-TLS13-1-2-2021-06')),
      hcl.attr('certificate_arn', hcl.ref('var', 'certificate_arn')),
      hcl.block(
        'default_action',
        [],
        [
          hcl.attr('type', hcl.string('forward')),
          hcl.attr('target_group_arn', arn('aws_lb_target_group')),
        ],
      ),
    ]),
    listener('http', 80, 'HTTP', [
      hcl.block(
        'default_action',
        [],
        [
          hcl.attr('type', hcl.string('redirect')),
          hcl.block(
            'redirect',
            [],
            [
              hcl.attr('port', hcl.string('443')),
              hcl.attr('protocol', hcl.string('HTTPS')),
              hcl.attr('status_code', hcl.string('HTTP_301')),
            ],
          ),
        ],
      ),
    ]),
    ...targets(input.links).map((peer, i) =>
      resource('aws_lb_target_group_attachment', `${block.name}_${i + 1}`, [
        hcl.attr('count', hcl.number(peer.usage.instanceCount ?? 1)),
        hcl.attr('target_group_arn', arn('aws_lb_target_group')),
        hcl.attr('target_id', hcl.ref('aws_instance', peer.name, hcl.countIndex, 'id')),
        hcl.attr('port', hcl.number(APP_PORT)),
      ]),
    ),
  ]);
};
