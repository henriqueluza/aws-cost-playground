import type { BlockGenerator } from '../generator';
import { hcl, type HclNode } from '../hcl';
import { ordinalId } from './network';
import { denyInsecureTransport, policyDocument, policyJson } from './policyDocument';
import { bucketObjects, bucketRef, privateBucket } from './privateBucket';

const resource = (type: string, name: string, body: readonly HclNode[]): HclNode =>
  hcl.block('resource', [type, name], body);

const variable = (name: string, description: string): HclNode =>
  hcl.block(
    'variable',
    [name],
    [hcl.attr('description', hcl.string(description)), hcl.attr('type', hcl.ref('string'))],
  );

const action = (name: string, category: string, provider: string, body: readonly HclNode[]) =>
  hcl.block(
    'stage',
    [],
    [
      hcl.attr('name', hcl.string(name)),
      hcl.block(
        'action',
        [],
        [
          hcl.attr('name', hcl.string(name)),
          hcl.attr('category', hcl.string(category)),
          hcl.attr('owner', hcl.string('AWS')),
          hcl.attr('provider', hcl.string(provider)),
          hcl.attr('version', hcl.string('1')),
          ...body,
        ],
      ),
    ],
  );

/**
 * CodePipeline: um pipeline com a origem numa conexão do CodeConnections e uma aprovação manual
 * no lugar do build e do deploy, que o design não descreve. A conexão e o repositório entram por
 * variável sem padrão: não há token nem segredo de webhook no arquivo. O papel do pipeline só usa
 * essa conexão e o bucket de artefatos, que é privado, criptografado e só aceita TLS.
 */
export const codepipeline: BlockGenerator = (input) => {
  const { block } = input;
  const id = ordinalId(input, 'pipeline');
  const artifacts = `${block.name}__artifacts`;
  const connection = `${block.name}__connection_arn`;
  const repository = `${block.name}__repository_id`;
  const pipelines = block.usage.activePipelines ?? 1;
  return {
    exported: true,
    nodes: [
      hcl.comment('Custo: o bucket de artefatos cobra armazenamento que o painel não mostra.'),
      hcl.comment(
        'O segundo estágio é uma aprovação manual: troque pelo build e deploy do projeto.',
      ),
      ...(pipelines === 1
        ? []
        : [hcl.comment(`O design tem ${pipelines} pipelines ativos; o arquivo gera um.`)]),
      variable(connection, 'ARN da conexão do CodeConnections com o provedor do repositório.'),
      variable(repository, 'Repositório de origem, no formato dono/repositório.'),
      ...privateBucket(artifacts, `${id}-artifacts-`),
      policyDocument(artifacts, [
        denyInsecureTransport('s3:*', [bucketRef(artifacts, 'arn'), bucketObjects(artifacts)]),
      ]),
      resource('aws_s3_bucket_policy', artifacts, [
        hcl.attr('bucket', bucketRef(artifacts, 'id')),
        hcl.attr('policy', policyJson(artifacts)),
        // Em paralelo com o bloqueio de acesso público, a API do S3 às vezes recusa por conflito.
        hcl.attr('depends_on', hcl.list([hcl.ref('aws_s3_bucket_public_access_block', artifacts)])),
      ]),
      policyDocument(`${block.name}__assume`, [
        {
          actions: ['sts:AssumeRole'],
          principal: { type: 'Service', identifiers: ['codepipeline.amazonaws.com'] },
        },
      ]),
      // O único curinga é o nome do objeto, dentro do bucket de artefatos deste pipeline.
      policyDocument(`${block.name}__permissions`, [
        {
          actions: ['codeconnections:UseConnection', 'codestar-connections:UseConnection'],
          resources: [hcl.ref('var', connection)],
        },
        { actions: ['s3:GetBucketVersioning'], resources: [bucketRef(artifacts, 'arn')] },
        {
          actions: ['s3:GetObject', 's3:GetObjectVersion', 's3:PutObject'],
          resources: [bucketObjects(artifacts)],
        },
      ]),
      resource('aws_iam_role', block.name, [
        hcl.attr('assume_role_policy', policyJson(`${block.name}__assume`)),
      ]),
      resource('aws_iam_role_policy', block.name, [
        hcl.attr('role', hcl.ref('aws_iam_role', block.name, 'id')),
        hcl.attr('policy', policyJson(`${block.name}__permissions`)),
      ]),
      resource('aws_codepipeline', block.name, [
        hcl.attr('name', hcl.string(id)),
        hcl.attr('role_arn', hcl.ref('aws_iam_role', block.name, 'arn')),
        hcl.attr('pipeline_type', hcl.string(String(block.attributes.pipelineType))),
        hcl.block(
          'artifact_store',
          [],
          [hcl.attr('location', bucketRef(artifacts, 'id')), hcl.attr('type', hcl.string('S3'))],
        ),
        action('Source', 'Source', 'CodeStarSourceConnection', [
          hcl.attr('output_artifacts', hcl.list([hcl.string('source')])),
          hcl.attr(
            'configuration',
            hcl.map({
              ConnectionArn: hcl.ref('var', connection),
              FullRepositoryId: hcl.ref('var', repository),
              BranchName: hcl.string('main'),
            }),
          ),
        ]),
        action('Approval', 'Approval', 'Manual', []),
      ]),
    ],
  };
};
