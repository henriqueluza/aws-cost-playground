import type { BlockGenerator } from '../generator';
import { hcl } from '../hcl';
import { dataPeers } from './links';
import { denyInsecureTransport, policyDocument, policyJson } from './policyDocument';

/** Dias até a transição quando o design pede Standard-IA (o mínimo que a AWS aceita). */
const IA_TRANSITION_DAYS = 30;
/** `bucket_prefix` aceita até 37 caracteres; o provider completa o nome com um sufixo único. */
const MAX_PREFIX = 36;

/**
 * Bucket privado: bloqueio de acesso público completo, ACLs desligadas, criptografia padrão e
 * política que nega tráfego sem TLS. Um CloudFront ligado por aresta de dados lê pelo Origin Access
 * Control: a política libera só o serviço, condicionado ao ARN da distribuição.
 */
export const s3: BlockGenerator = ({ block, links }) => {
  const { name } = block;
  const id = hcl.attr('bucket', hcl.ref('aws_s3_bucket', name, 'id'));
  const arn = hcl.ref('aws_s3_bucket', name, 'arn');
  const objects = hcl.call('format', [hcl.string('%s/*'), arn]);
  const prefix = `${name.replaceAll('_', '-').slice(0, MAX_PREFIX).replace(/-+$/, '')}-`;

  const lifecycle =
    block.attributes.storageClass === 'STANDARD_IA'
      ? [
          hcl.block(
            'resource',
            ['aws_s3_bucket_lifecycle_configuration', name],
            [
              id,
              hcl.block(
                'rule',
                [],
                [
                  hcl.attr('id', hcl.string('standard-ia')),
                  hcl.attr('status', hcl.string('Enabled')),
                  hcl.block('filter', [], []),
                  hcl.block(
                    'transition',
                    [],
                    [
                      hcl.attr('days', hcl.number(IA_TRANSITION_DAYS)),
                      hcl.attr('storage_class', hcl.string('STANDARD_IA')),
                    ],
                  ),
                ],
              ),
            ],
          ),
        ]
      : [];

  const readers = dataPeers(links, 'target', 'aws.cloudfront').map((distribution) => ({
    actions: ['s3:GetObject'],
    resources: [objects],
    principal: { type: 'Service' as const, identifiers: ['cloudfront.amazonaws.com'] },
    condition: {
      test: 'StringEquals',
      variable: 'AWS:SourceArn',
      values: [hcl.ref('aws_cloudfront_distribution', distribution.name, 'arn')],
    },
  }));

  return {
    exported: true,
    nodes: [
      hcl.comment('O nome do bucket é global: o provider completa o prefixo com um sufixo único.'),
      hcl.comment('Versionamento não é ligado: o design não o descreve e ele muda o custo.'),
      hcl.block(
        'resource',
        ['aws_s3_bucket', name],
        [hcl.attr('bucket_prefix', hcl.string(prefix))],
      ),
      hcl.block(
        'resource',
        ['aws_s3_bucket_public_access_block', name],
        [
          id,
          hcl.attr('block_public_acls', hcl.bool(true)),
          hcl.attr('block_public_policy', hcl.bool(true)),
          hcl.attr('ignore_public_acls', hcl.bool(true)),
          hcl.attr('restrict_public_buckets', hcl.bool(true)),
        ],
      ),
      hcl.block(
        'resource',
        ['aws_s3_bucket_ownership_controls', name],
        [
          id,
          hcl.block('rule', [], [hcl.attr('object_ownership', hcl.string('BucketOwnerEnforced'))]),
        ],
      ),
      hcl.block(
        'resource',
        ['aws_s3_bucket_server_side_encryption_configuration', name],
        [
          id,
          hcl.block(
            'rule',
            [],
            [
              hcl.block(
                'apply_server_side_encryption_by_default',
                [],
                [hcl.attr('sse_algorithm', hcl.string('AES256'))],
              ),
            ],
          ),
        ],
      ),
      ...lifecycle,
      policyDocument(name, [denyInsecureTransport('s3:*', [arn, objects]), ...readers]),
      hcl.block(
        'resource',
        ['aws_s3_bucket_policy', name],
        [
          id,
          hcl.attr('policy', policyJson(name)),
          hcl.attr('depends_on', hcl.list([hcl.ref('aws_s3_bucket_public_access_block', name)])),
        ],
      ),
    ],
  };
};
