import type { BlockGenerator, ExportBlock } from '../generator';
import { hcl, type HclNode } from '../hcl';
import { ecsClusterOf } from './links';
import { blockAz, securityGroupId, subnetId, withNetwork } from './network';

type Architecture = 'arm64' | 'x86_64';
/** `al2023`: Amazon Linux 2023 puro. `ecs`: a variante com o agente do ECS, para hospedar um cluster. */
type Image = 'al2023' | 'ecs';
const IMAGE_NAME: Record<Image, string> = {
  al2023: 'al2023-ami-2023.*-',
  ecs: 'al2023-ami-ecs-hvm-2023.*-',
};

/** Famílias Graviton do contrato (`t4g`) usam imagem arm64; as demais, x86_64. */
const architecture = (block: ExportBlock): Architecture =>
  String(block.attributes.instanceType).startsWith('t4g.') ? 'arm64' : 'x86_64';

/** Imagem mais recente da Amazon, por data source: nenhum ID de AMI preso a uma região. */
const amiLookup = (image: Image, arch: Architecture): HclNode =>
  hcl.block(
    'data',
    ['aws_ami', `${image}_${arch}`],
    [
      hcl.attr('most_recent', hcl.bool(true)),
      hcl.attr('owners', hcl.list([hcl.string('amazon')])),
      hcl.block(
        'filter',
        [],
        [
          hcl.attr('name', hcl.string('name')),
          hcl.attr('values', hcl.list([hcl.string(`${IMAGE_NAME[image]}${arch}`)])),
        ],
      ),
    ],
  );

/** IMDSv2 obrigatório, sem salto: contêiner em rede própria não alcança a credencial da instância. */
const METADATA = hcl.block(
  'metadata_options',
  [],
  [
    hcl.attr('http_endpoint', hcl.string('enabled')),
    hcl.attr('http_tokens', hcl.string('required')),
    hcl.attr('http_put_response_hop_limit', hcl.number(1)),
  ],
);
const rootVolume = (block: ExportBlock): HclNode[] => [
  hcl.attr('encrypted', hcl.bool(true)),
  hcl.attr('volume_type', hcl.string('gp3')),
  hcl.attr('volume_size', hcl.number(block.usage.rootVolumeGb ?? 30)),
];

/**
 * EC2 que hospeda um cluster ECS: as mesmas instâncias do design (tipo, zona, quantidade e volume),
 * mas num Auto Scaling group de tamanho fixo, que é o que o capacity provider do ECS exige. A
 * instância entra no cluster pelo `ECS_CLUSTER` do `user_data` e usa o perfil emitido pelo bloco ECS.
 */
function ecsHost(block: ExportBlock, cluster: ExportBlock, ami: HclNode[]): HclNode[] {
  const count = hcl.number(block.usage.instanceCount ?? 1);
  return [
    ...ami,
    hcl.block(
      'resource',
      ['aws_launch_template', block.name],
      [
        hcl.attr('image_id', hcl.ref('data', 'aws_ami', `ecs_${architecture(block)}`, 'id')),
        hcl.attr('instance_type', hcl.string(String(block.attributes.instanceType))),
        hcl.attr('vpc_security_group_ids', hcl.list([securityGroupId('app')])),
        hcl.attr(
          'user_data',
          hcl.call('base64encode', [
            hcl.call('format', [
              hcl.string('#!/bin/bash\necho ECS_CLUSTER=%s >> /etc/ecs/ecs.config\n'),
              hcl.ref('aws_ecs_cluster', cluster.name, 'name'),
            ]),
          ]),
        ),
        hcl.block(
          'iam_instance_profile',
          [],
          [hcl.attr('arn', hcl.ref('aws_iam_instance_profile', `${cluster.name}__host`, 'arn'))],
        ),
        METADATA,
        hcl.block(
          'block_device_mappings',
          [],
          [
            hcl.attr('device_name', hcl.string('/dev/xvda')),
            hcl.block('ebs', [], rootVolume(block)),
          ],
        ),
      ],
    ),
    hcl.block(
      'resource',
      ['aws_autoscaling_group', block.name],
      [
        hcl.attr('min_size', count),
        hcl.attr('max_size', count),
        hcl.attr('desired_capacity', count),
        hcl.attr('vpc_zone_identifier', hcl.list([subnetId('private', blockAz(block))])),
        hcl.block(
          'launch_template',
          [],
          [
            hcl.attr('id', hcl.ref('aws_launch_template', block.name, 'id')),
            hcl.attr('version', hcl.ref('aws_launch_template', block.name, 'latest_version')),
          ],
        ),
      ],
    ),
  ];
}

/**
 * EC2: instâncias em sub-rede privada, sem IP público e sem par de chaves (não há SSH aberto),
 * com IMDSv2 obrigatório e volume raiz criptografado. A imagem é emitida uma vez por arquitetura,
 * pelo primeiro bloco EC2 que a usa. Com uma aresta `runs-on` vinda de um bloco ECS, as instâncias
 * saem num Auto Scaling group (`ecsHost`) em vez de `aws_instance`.
 */
export const ec2: BlockGenerator = (input) => {
  const { block } = input;
  const arch = architecture(block);
  const clusterOf = (candidate: ExportBlock) =>
    ecsClusterOf(input.designLinks.get(candidate.id) ?? []);
  const cluster = clusterOf(block);
  const image: Image = cluster ? 'ecs' : 'al2023';
  const firstOfImage = input.blocks.find(
    (b) => b.type === 'aws.ec2' && architecture(b) === arch && !clusterOf(b) === !cluster,
  );
  const ami = firstOfImage?.id === block.id ? [amiLookup(image, arch)] : [];
  if (cluster) return withNetwork(input, ecsHost(block, cluster, ami));
  return withNetwork(input, [
    ...ami,
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
        METADATA,
        hcl.block('root_block_device', [], rootVolume(block)),
      ],
    ),
  ]);
};
