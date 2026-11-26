import type { BlockGenerator } from '../generator';
import { hcl } from '../hcl';
import { designAzs, subnetId, withNetwork } from './network';

/**
 * NAT Gateway: um por bloco, numa sub-rede pública, com Elastic IP. Os blocos de NAT se repartem
 * pelas zonas na ordem do id, e cada um recebe a rota padrão das tabelas privadas das suas zonas.
 */
export const natGateway: BlockGenerator = (input) => {
  const { block } = input;
  const gateways = input.blocks.filter((candidate) => candidate.type === 'aws.nat-gateway');
  const position = gateways.findIndex((candidate) => candidate.id === block.id);
  const azs = designAzs(input.blocks);
  const served = azs.filter((_, i) => i % gateways.length === position);
  return withNetwork(input, [
    hcl.block('resource', ['aws_eip', block.name], [hcl.attr('domain', hcl.string('vpc'))]),
    hcl.block(
      'resource',
      ['aws_nat_gateway', block.name],
      [
        hcl.attr('allocation_id', hcl.ref('aws_eip', block.name, 'id')),
        hcl.attr('subnet_id', subnetId('public', azs[position % azs.length] ?? 'a')),
        hcl.attr('depends_on', hcl.list([hcl.ref('aws_internet_gateway', 'main')])),
      ],
    ),
    ...(served.length === 0
      ? [hcl.comment('Há mais NAT Gateways que zonas: este não recebe a rota de nenhuma sub-rede.')]
      : []),
    ...served.map((az) =>
      hcl.block(
        'resource',
        ['aws_route', `${block.name}_${az}`],
        [
          hcl.attr('route_table_id', hcl.ref('aws_route_table', `private_${az}`, 'id')),
          hcl.attr('destination_cidr_block', hcl.string('0.0.0.0/0')),
          hcl.attr('nat_gateway_id', hcl.ref('aws_nat_gateway', block.name, 'id')),
        ],
      ),
    ),
  ]);
};
