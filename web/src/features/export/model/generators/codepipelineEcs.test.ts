import { describe, expect, it } from 'vitest';
import appClassico from '../../../../../../contracts/scenarios/app-classico.json';
import { attrs, blocksOf, labels, named } from '../../test/generatorKit';
import {
  bodies,
  body,
  generate,
  mainTf,
  plain,
  resourceTypes,
  statements,
  value,
} from '../../test/generatorHarness';
import { levelBcDesign } from '../../test/levelBcDesign';
import { allowedWildcards, SENSITIVE_LITERAL } from '../../test/securityAssertions';
import { renderHcl } from '../hcl';

describe('gerador de CodePipeline', () => {
  const nodes = generate([
    { id: 'entrega', type: 'aws.codepipeline', usage: { activePipelines: 4 } },
    { id: 'antigo', type: 'aws.codepipeline', attributes: { pipelineType: 'V1' } },
  ]);
  const pipeline = body(nodes, 'resource', 'aws_codepipeline', 'entrega');
  const stage = (index: number) => attrs(blocksOf(pipeline, undefined, 'stage')[index]!);

  it('gera o pipeline do tipo do design, com origem por conexão e aprovação manual', () => {
    expect(attrs(named(nodes, 'aws_codepipeline', 'entrega'))).toMatchObject({
      name: '"pipeline-2"',
      role_arn: 'aws_iam_role.entrega.arn',
      pipeline_type: '"V2"',
      'artifact_store.location': 'aws_s3_bucket.entrega__artifacts.id',
      'artifact_store.type': '"S3"',
    });
    expect(attrs(named(nodes, 'aws_codepipeline', 'antigo')).pipeline_type).toBe('"V1"');
    expect(stage(0)).toMatchObject({
      name: '"Source"',
      'action.category': '"Source"',
      'action.owner': '"AWS"',
      'action.provider': '"CodeStarSourceConnection"',
      'action.output_artifacts': '["source"]',
    });
    expect(stage(1)).toMatchObject({
      'action.category': '"Approval"',
      'action.provider': '"Manual"',
    });
    expect(renderHcl(nodes)).toContain('# O design tem 4 pipelines ativos; o arquivo gera um.');
  });

  it('não tem token: a conexão e o repositório vêm de variáveis sem padrão', () => {
    const [source = []] = bodies(pipeline, 'stage').map((s) => bodies(s, 'action')[0] ?? []);
    expect(renderHcl([{ kind: 'attribute', name: 'c', value: value(source, 'configuration')! }]))
      .toBe(`c = {
  "ConnectionArn"    = var.entrega__connection_arn
  "FullRepositoryId" = var.entrega__repository_id
  "BranchName"       = "main"
}
`);
    for (const name of ['entrega__connection_arn', 'entrega__repository_id']) {
      expect(Object.keys(attrs(blocksOf(nodes, name, 'variable')[0]!))).toEqual([
        'description',
        'type',
      ]);
    }
    const text = renderHcl(nodes);
    expect(text).not.toMatch(SENSITIVE_LITERAL);
    expect(text).not.toMatch(/OAuthToken|"GitHub"|ThirdParty|aws_codepipeline_webhook/);
  });

  it('o papel só usa a conexão e o bucket de artefatos, que é privado, criptografado e só TLS', () => {
    const permissions = statements(nodes, 'entrega__permissions').map((statement) => [
      plain(value(statement, 'actions')),
      renderHcl([{ kind: 'attribute', name: 'r', value: value(statement, 'resources')! }]).trim(),
    ]);
    expect(permissions).toEqual([
      [
        ['codeconnections:UseConnection', 'codestar-connections:UseConnection'],
        'r = [var.entrega__connection_arn]',
      ],
      [['s3:GetBucketVersioning'], 'r = [aws_s3_bucket.entrega__artifacts.arn]'],
      [
        ['s3:GetObject', 's3:GetObjectVersion', 's3:PutObject'],
        'r = [format("%s/*", aws_s3_bucket.entrega__artifacts.arn)]',
      ],
    ]);
    expect(allowedWildcards(nodes)).toEqual([
      'format("%s/*", aws_s3_bucket.antigo__artifacts.arn)',
      'format("%s/*", aws_s3_bucket.entrega__artifacts.arn)',
    ]);
    expect(resourceTypes(nodes, 'entrega')).toEqual([
      'aws_s3_bucket',
      'aws_s3_bucket_public_access_block',
      'aws_s3_bucket_server_side_encryption_configuration',
      'aws_s3_bucket_policy',
      'aws_iam_role',
      'aws_iam_role_policy',
      'aws_codepipeline',
    ]);
    const [tls = []] = statements(nodes, 'entrega__artifacts');
    expect(plain(value(tls, 'effect'))).toBe('Deny');
    expect(renderHcl(tls)).toContain(
      'resources = [aws_s3_bucket.entrega__artifacts.arn, format("%s/*", aws_s3_bucket.entrega__artifacts.arn)]',
    );
    expect(attrs(named(nodes, 'aws_s3_bucket_policy', 'entrega__artifacts'))).toEqual({
      bucket: 'aws_s3_bucket.entrega__artifacts.id',
      policy: 'data.aws_iam_policy_document.entrega__artifacts.json',
      depends_on: '[aws_s3_bucket_public_access_block.entrega__artifacts]',
    });
    expect(renderHcl(nodes)).toContain('# Custo: o bucket de artefatos cobra armazenamento');
  });
});

describe('gerador de ECS', () => {
  const nodes = generate(
    [
      { id: 'cluster', type: 'aws.ecs' },
      {
        id: 'nos',
        type: 'aws.ec2',
        attributes: { instanceType: 't4g.small', az: 'b' },
        usage: { instanceCount: 3, rootVolumeGb: 40 },
      },
      { id: 'web', type: 'aws.ec2' },
      { id: 'lb', type: 'aws.alb' },
      { id: 'outro', type: 'aws.ecs' },
      { id: 'vazio', type: 'aws.ecs' },
    ],
    [
      ['cluster', 'nos', 'runs-on'],
      ['outro', 'nos', 'runs-on'],
      ['cluster', 'web'],
      ['lb', 'nos'],
      ['lb', 'web'],
    ],
  );

  it('gera o cluster e um capacity provider sobre o Auto Scaling group do EC2 da aresta runs-on', () => {
    expect(attrs(named(nodes, 'aws_ecs_cluster', 'cluster'))).toEqual({
      name: '"cluster-1"',
      'setting.name': '"containerInsights"',
      'setting.value': '"disabled"',
    });
    expect(attrs(named(nodes, 'aws_ecs_capacity_provider', 'cluster__ec2_1'))).toEqual({
      name: '"cluster-1-ec2-1"',
      'auto_scaling_group_provider.auto_scaling_group_arn': 'aws_autoscaling_group.nos.arn',
      'auto_scaling_group_provider.managed_termination_protection': '"DISABLED"',
      'auto_scaling_group_provider.managed_scaling.status': '"DISABLED"',
    });
    expect(attrs(named(nodes, 'aws_ecs_cluster_capacity_providers', 'cluster'))).toEqual({
      cluster_name: 'aws_ecs_cluster.cluster.name',
      capacity_providers: '[aws_ecs_capacity_provider.cluster__ec2_1.name]',
      'default_capacity_provider_strategy.capacity_provider':
        'aws_ecs_capacity_provider.cluster__ec2_1.name',
      'default_capacity_provider_strategy.weight': '1',
    });
  });

  it('o EC2 da aresta vira um Auto Scaling group fixo, com as instâncias do design', () => {
    expect(labels(nodes, 'aws_instance')).toEqual(['web']);
    expect(attrs(named(nodes, 'aws_autoscaling_group', 'nos'))).toEqual({
      min_size: '3',
      max_size: '3',
      desired_capacity: '3',
      vpc_zone_identifier: '[aws_subnet.private_b.id]',
      'launch_template.id': 'aws_launch_template.nos.id',
      'launch_template.version': 'aws_launch_template.nos.latest_version',
    });
    expect(attrs(named(nodes, 'aws_launch_template', 'nos'))).toEqual({
      image_id: 'data.aws_ami.ecs_arm64.id',
      instance_type: '"t4g.small"',
      vpc_security_group_ids: '[aws_security_group.app.id]',
      user_data:
        'base64encode(format("#!/bin/bash\\necho ECS_CLUSTER=%s >> /etc/ecs/ecs.config\\n", aws_ecs_cluster.cluster.name))',
      'iam_instance_profile.arn': 'aws_iam_instance_profile.cluster__host.arn',
      'metadata_options.http_endpoint': '"enabled"',
      'metadata_options.http_tokens': '"required"',
      'metadata_options.http_put_response_hop_limit': '1',
      'block_device_mappings.device_name': '"/dev/xvda"',
      'block_device_mappings.ebs.encrypted': 'true',
      'block_device_mappings.ebs.volume_type': '"gp3"',
      'block_device_mappings.ebs.volume_size': '40',
    });
    expect(blocksOf(nodes, 'aws_ami', 'data').map((data) => attrs(data)['filter.values'])).toEqual([
      '["al2023-ami-ecs-hvm-2023.*-arm64"]',
      '["al2023-ami-2023.*-x86_64"]',
    ]);
    expect(renderHcl(nodes)).not.toMatch(/key_name|associate_public_ip_address\s*=\s*true/);
  });

  it('o papel das instâncias confia só no EC2 e leva só a política gerenciada do agente', () => {
    const [trust = []] = statements(nodes, 'cluster__host');
    expect(attrs(blocksOf(trust, undefined, 'principals')[0]!)).toEqual({
      type: '"Service"',
      identifiers: '["ec2.amazonaws.com"]',
    });
    expect(attrs(named(nodes, 'aws_iam_role_policy_attachment', 'cluster__host'))).toEqual({
      role: 'aws_iam_role.cluster__host.name',
      policy_arn:
        'format("arn:%s:iam::aws:policy/service-role/AmazonEC2ContainerServiceforEC2Role", data.aws_partition.cluster.partition)',
    });
    expect(attrs(named(nodes, 'aws_iam_instance_profile', 'cluster__host'))).toEqual({
      role: 'aws_iam_role.cluster__host.name',
    });
    expect(allowedWildcards(nodes)).toEqual([]);
    expect(labels(nodes, 'aws_iam_role_policy')).toEqual([]);
  });

  it('um EC2 serve a um cluster só, e cluster sem aresta fica sem capacidade', () => {
    expect(labels(nodes, 'aws_ecs_capacity_provider')).toEqual(['cluster__ec2_1']);
    expect(labels(nodes, 'aws_ecs_cluster')).toEqual(['cluster', 'outro', 'vazio']);
    expect(labels(nodes, 'aws_iam_instance_profile')).toEqual(['cluster__host']);
    const text = renderHcl(nodes);
    expect(text.match(/# Um EC2 ligado já hospeda outro cluster/g)).toHaveLength(1);
    expect(text.match(/# Sem aresta runs-on para um EC2/g)).toHaveLength(2);
  });

  it('o ALB anexa o grupo inteiro do EC2 que hospeda o cluster, e as instâncias dos demais', () => {
    expect(attrs(named(nodes, 'aws_autoscaling_attachment', 'lb_1'))).toEqual({
      autoscaling_group_name: 'aws_autoscaling_group.nos.name',
      lb_target_group_arn: 'aws_lb_target_group.lb.arn',
    });
    expect(attrs(named(nodes, 'aws_lb_target_group_attachment', 'lb_2')).target_id).toBe(
      'aws_instance.web[count.index].id',
    );
    expect(labels(nodes, 'aws_lb_target_group_attachment')).toEqual(['lb_2']);
    expect(labels(nodes, 'aws_autoscaling_attachment')).toEqual(['lb_1']);
  });

  it('sem bloco ECS nada muda: o app-classico continua com aws_instance', () => {
    const text = mainTf(appClassico);
    expect(text).not.toMatch(/aws_autoscaling_group|aws_launch_template|aws_ecs_/);
    expect(text.match(/^resource "aws_instance" /gm)).toHaveLength(2);
  });

  it('o design com os nove blocos exporta tudo, com o ECS ligado ao EC2', () => {
    const text = mainTf(levelBcDesign);
    expect(text).toMatch(/^# Blocos exportados: 13 de 13\.$/m);
    expect(text).toContain(
      'auto_scaling_group_arn         = aws_autoscaling_group.nos_do_cluster.arn',
    );
    expect(text).not.toMatch(/Não suportado ainda/);
  });
});
