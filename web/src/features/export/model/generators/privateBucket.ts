import { hcl, type HclNode, type HclValue } from '../hcl';

const resource = (type: string, name: string, body: readonly HclNode[]): HclNode =>
  hcl.block('resource', [type, name], body);

export const bucketRef = (label: string, attribute: 'id' | 'arn'): HclValue =>
  hcl.ref('aws_s3_bucket', label, attribute);

/** ARN dos objetos do bucket: o padrão de `format` recebe o ARN do bucket e depois `args`. */
export const bucketObjects = (label: string, pattern = '%s/*', ...args: HclValue[]): HclValue =>
  hcl.call('format', [hcl.string(pattern), bucketRef(label, 'arn'), ...args]);

/**
 * Bucket de apoio de um bloco (logs, artefatos): privado, com todo acesso público bloqueado e
 * criptografia em repouso. O nome sai de um prefixo fixo; o sufixo é dado pela AWS.
 */
export function privateBucket(label: string, prefix: string): HclNode[] {
  const bucket = hcl.attr('bucket', bucketRef(label, 'id'));
  return [
    resource('aws_s3_bucket', label, [hcl.attr('bucket_prefix', hcl.string(prefix))]),
    resource('aws_s3_bucket_public_access_block', label, [
      bucket,
      hcl.attr('block_public_acls', hcl.bool(true)),
      hcl.attr('block_public_policy', hcl.bool(true)),
      hcl.attr('ignore_public_acls', hcl.bool(true)),
      hcl.attr('restrict_public_buckets', hcl.bool(true)),
    ]),
    resource('aws_s3_bucket_server_side_encryption_configuration', label, [
      bucket,
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
    ]),
  ];
}
