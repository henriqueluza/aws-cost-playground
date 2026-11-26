import type { BlockGenerator, ExportBlock } from '../generator';
import { hcl, type HclNode } from '../hcl';
import { ecsClusterOf } from './links';
import { ordinalId } from './network';
import { policyDocument, policyJson } from './policyDocument';

const resource = (type: string, name: string, body: readonly HclNode[]): HclNode =>
  hcl.block('resource', [type, name], body);

/** Papel e perfil das instâncias do cluster: só a política gerenciada do agente do ECS. */
function hostProfile(name: string): HclNode[] {
  const host = `${name}__host`;
  return [
    hcl.comment('O papel das instâncias leva só a política gerenciada do agente do ECS, mantida'),
    hcl.comment('pela AWS. Permissão de aplicação vai no papel da tarefa, não aqui.'),
    hcl.block('data', ['aws_partition', name], []),
    policyDocument(host, [
      {
        actions: ['sts:AssumeRole'],
        principal: { type: 'Service', identifiers: ['ec2.amazonaws.com'] },
      },
    ]),
    resource('aws_iam_role', host, [hcl.attr('assume_role_policy', policyJson(host))]),
    resource('aws_iam_role_policy_attachment', host, [
      hcl.attr('role', hcl.ref('aws_iam_role', host, 'name')),
      hcl.attr(
        'policy_arn',
        hcl.call('format', [
          hcl.string('arn:%s:iam::aws:policy/service-role/AmazonEC2ContainerServiceforEC2Role'),
          hcl.ref('data', 'aws_partition', name, 'partition'),
        ]),
      ),
    ]),
    resource('aws_iam_instance_profile', host, [
      hcl.attr('role', hcl.ref('aws_iam_role', host, 'name')),
    ]),
  ];
}

/**
 * ECS: o cluster e, para cada EC2 ligado por aresta `runs-on`, um capacity provider sobre o Auto
 * Scaling group que o gerador de EC2 emite para esse bloco. O escalonamento gerenciado fica
 * desligado: o número de instâncias é o do design, o mesmo que o painel de custo mostra.
 * Tarefas e serviços não são gerados: o design não diz o que roda no cluster.
 */
export const ecs: BlockGenerator = (input) => {
  const { block, links } = input;
  const id = ordinalId(input, 'cluster');
  const linked = new Map<string, ExportBlock>();
  for (const { kind, role, peer } of links) {
    if (kind === 'runs-on' && role === 'source' && peer?.type === 'aws.ec2') {
      linked.set(peer.id, peer);
    }
  }
  // Um EC2 ligado a dois clusters fica com o primeiro: o grupo só serve a um capacity provider.
  const hosts = [...linked.values()].filter(
    (host) => ecsClusterOf(input.designLinks.get(host.id) ?? [])?.id === block.id,
  );
  const provider = (index: number) => `${block.name}__ec2_${index + 1}`;
  const providerName = (index: number) =>
    hcl.ref('aws_ecs_capacity_provider', provider(index), 'name');
  return {
    exported: true,
    nodes: [
      hcl.comment('O cluster não tem custo próprio: as instâncias são as do bloco EC2 ligado.'),
      hcl.comment('Tarefas e serviços não são gerados; Container Insights fica desligado (custo).'),
      ...(hosts.length < linked.size
        ? [hcl.comment('Um EC2 ligado já hospeda outro cluster e não entra neste.')]
        : []),
      resource('aws_ecs_cluster', block.name, [
        hcl.attr('name', hcl.string(id)),
        hcl.block(
          'setting',
          [],
          [
            hcl.attr('name', hcl.string('containerInsights')),
            hcl.attr('value', hcl.string('disabled')),
          ],
        ),
      ]),
      ...(hosts.length > 0
        ? [
            ...hostProfile(block.name),
            ...hosts.map((host, i) =>
              resource('aws_ecs_capacity_provider', provider(i), [
                hcl.attr('name', hcl.string(`${id}-ec2-${i + 1}`)),
                hcl.block(
                  'auto_scaling_group_provider',
                  [],
                  [
                    hcl.attr(
                      'auto_scaling_group_arn',
                      hcl.ref('aws_autoscaling_group', host.name, 'arn'),
                    ),
                    hcl.attr('managed_termination_protection', hcl.string('DISABLED')),
                    hcl.block('managed_scaling', [], [hcl.attr('status', hcl.string('DISABLED'))]),
                  ],
                ),
              ]),
            ),
            resource('aws_ecs_cluster_capacity_providers', block.name, [
              hcl.attr('cluster_name', hcl.ref('aws_ecs_cluster', block.name, 'name')),
              hcl.attr('capacity_providers', hcl.list(hosts.map((_, i) => providerName(i)))),
              hcl.block(
                'default_capacity_provider_strategy',
                [],
                [hcl.attr('capacity_provider', providerName(0)), hcl.attr('weight', hcl.number(1))],
              ),
            ]),
          ]
        : [hcl.comment('Sem aresta runs-on para um EC2: o cluster fica sem capacidade.')]),
    ],
  };
};
