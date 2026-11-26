import type { BlockGenerator, ExportBlock } from '../generator';
import { hcl, type HclNode } from '../hcl';
import { blockAz, securityGroupId, subnetId, withNetwork } from './network';

type Architecture = 'arm64' | 'x86_64';

/** Famílias Graviton do contrato (`t4g`) usam imagem arm64; as demais, x86_64. */
const architecture = (block: ExportBlock): Architecture =>
  String(block.attributes.instanceType).startsWith('t4g.') ? 'arm64' : 'x86_64';

/** Imagem mais recente do Amazon Linux 2023, por data source: nenhum ID de AMI preso a uma região. */
const amiLookup = (arch: Architecture): HclNode =>
  hcl.block(
    'data',
    ['aws_ami', `al2023_${arch}`],
    [
      hcl.attr('most_recent', hcl.bool(true)),
      hcl.attr('owners', hcl.list([hcl.string('amazon')])),
      hcl.block(
        'filter',
        [],
        [
          hcl.attr('name', hcl.string('name')),
          hcl.attr('values', hcl.list([hcl.string(`al2023-ami-2023.*-${arch}`)])),
        ],
      ),
    ],
  );

/**
 * EC2: instâncias em sub-rede privada, sem IP público e sem par de chaves (não há SSH aberto),
 * com IMDSv2 obrigatório e volume raiz criptografado. A imagem é emitida uma vez por arquitetura,
 * pelo primeiro bloco EC2 que a usa.
 */
export const ec2: BlockGenerator = (input) => {
  const { block } = input;
  const arch = architecture(block);
  const firstOfArch = input.blocks.find((b) => b.type === 'aws.ec2' && architecture(b) === arch);
  return withNetwork(input, [
    ...(firstOfArch?.id === block.id ? [amiLookup(arch)] : []),
    hcl.block(
      'resource',
      ['aws_instance', block.name],
      [
        hcl.attr('count', hcl.number(block.usage.instanceCount ?? 1)),
        hcl.attr('ami', hcl.ref('data', 'aws_ami', `al2023_${arch}`, 'id')),
        hcl.attr('instance_type', hcl.string(String(block.attributes.instanceType))),
        hcl.attr('subnet_id', subnetId('private', blockAz(block))),
        hcl.attr('vpc_security_group_ids', hcl.list([securityGroupId('app')])),
        hcl.attr('associate_public_ip_address', hcl.bool(false)),
        hcl.block(
          'metadata_options',
          [],
          [
            hcl.attr('http_endpoint', hcl.string('enabled')),
            hcl.attr('http_tokens', hcl.string('required')),
            hcl.attr('http_put_response_hop_limit', hcl.number(1)),
          ],
        ),
        hcl.block(
          'root_block_device',
          [],
          [
            hcl.attr('encrypted', hcl.bool(true)),
            hcl.attr('volume_type', hcl.string('gp3')),
            hcl.attr('volume_size', hcl.number(block.usage.rootVolumeGb ?? 30)),
          ],
        ),
      ],
    ),
  ]);
};
