import type { BlockGenerator, ExportBlock } from '../generator';
import { hcl } from '../hcl';

/**
 * Route 53: uma zona pública cujo domínio vem de uma variável sem padrão (o design não tem domínio
 * e nenhum é inventado). O primeiro ALB ligado por aresta de dados recebe o registro do domínio.
 */
export const route53: BlockGenerator = ({ block, links }) => {
  const domain = `${block.name}__domain`;
  const zones = block.usage.hostedZones ?? 1;
  const balancers = new Map<string, ExportBlock>();
  for (const { kind, peer } of links) {
    if (kind === 'data' && peer?.type === 'aws.alb') balancers.set(peer.id, peer);
  }
  const [target, ...others] = [...balancers.values()];
  return {
    exported: true,
    nodes: [
      hcl.comment('O registro do domínio não é gerado: aponte o domínio para os servidores de'),
      hcl.comment('nomes desta zona (atributo name_servers) depois de aplicar.'),
      ...(zones > 1
        ? [hcl.comment(`O design pede ${zones} zonas; só uma é gerada, as outras não têm domínio.`)]
        : []),
      hcl.block(
        'variable',
        [domain],
        [
          hcl.attr(
            'description',
            hcl.string('Domínio da zona hospedada (por exemplo exemplo.com).'),
          ),
          hcl.attr('type', hcl.ref('string')),
        ],
      ),
      hcl.block(
        'resource',
        ['aws_route53_zone', block.name],
        [hcl.attr('name', hcl.ref('var', domain))],
      ),
      ...(others.length > 0
        ? [
            hcl.comment(
              'Só o primeiro ALB ligado recebe o registro: um nome aponta para um destino.',
            ),
          ]
        : []),
      ...(target
        ? [
            hcl.block(
              'resource',
              ['aws_route53_record', `${block.name}__alb`],
              [
                hcl.attr('zone_id', hcl.ref('aws_route53_zone', block.name, 'zone_id')),
                hcl.attr('name', hcl.ref('var', domain)),
                hcl.attr('type', hcl.string('A')),
                hcl.block(
                  'alias',
                  [],
                  [
                    hcl.attr('name', hcl.ref('aws_lb', target.name, 'dns_name')),
                    hcl.attr('zone_id', hcl.ref('aws_lb', target.name, 'zone_id')),
                    hcl.attr('evaluate_target_health', hcl.bool(true)),
                  ],
                ),
              ],
            ),
          ]
        : []),
    ],
  };
};
