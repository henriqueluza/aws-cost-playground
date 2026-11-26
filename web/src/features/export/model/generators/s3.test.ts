import { describe, expect, it } from 'vitest';
import { hcl, renderHcl } from '../hcl';
import {
  body,
  bodies,
  design,
  generate,
  mainTf,
  plain,
  resourceTypes,
  statements,
  value,
} from '../../test/generatorHarness';

const bucket = { id: 'b', type: 'aws.s3', label: 'Meu Bucket' };
const cdn = { id: 'cdn', type: 'aws.cloudfront' };
const arn = hcl.ref('aws_s3_bucket', 'meu_bucket', 'arn');
const objects = hcl.call('format', [hcl.string('%s/*'), arn]);

describe('gerador do S3', () => {
  const nodes = generate([bucket]);

  it('gera o bucket privado, criptografado e sem ACL', () => {
    expect(resourceTypes(nodes)).toEqual([
      'aws_s3_bucket',
      'aws_s3_bucket_public_access_block',
      'aws_s3_bucket_ownership_controls',
      'aws_s3_bucket_server_side_encryption_configuration',
      'aws_s3_bucket_policy',
    ]);
    const access = body(nodes, 'resource', 'aws_s3_bucket_public_access_block', 'meu_bucket');
    for (const flag of [
      'block_public_acls',
      'block_public_policy',
      'ignore_public_acls',
      'restrict_public_buckets',
    ]) {
      expect(plain(value(access, flag))).toBe(true);
    }
    expect(value(access, 'bucket')).toEqual(hcl.ref('aws_s3_bucket', 'meu_bucket', 'id'));
    const sse = body(
      nodes,
      'resource',
      'aws_s3_bucket_server_side_encryption_configuration',
      'meu_bucket',
    );
    const byDefault = body(body(sse, 'rule'), 'apply_server_side_encryption_by_default');
    expect(plain(value(byDefault, 'sse_algorithm'))).toBe('AES256');
    const ownership = body(nodes, 'resource', 'aws_s3_bucket_ownership_controls', 'meu_bucket');
    expect(plain(value(body(ownership, 'rule'), 'object_ownership'))).toBe('BucketOwnerEnforced');
    expect(renderHcl(nodes)).not.toMatch(/\b(acl|force_destroy)\b/);
  });

  it.each([
    ['Meu Bucket', 'meu-bucket-'],
    ['Ação_çã 2', 'acao-ca-2-'],
    ['x'.repeat(80), `${'x'.repeat(36)}-`],
    [`${'x'.repeat(35)} y`, `${'x'.repeat(35)}-`],
  ])('o nome do bucket é um prefixo saneado de "%s", sem o rótulo cru', (label, prefix) => {
    const [main] = bodies(generate([{ ...bucket, label }]), 'resource', 'aws_s3_bucket');
    expect(plain(value(main ?? [], 'bucket_prefix'))).toBe(prefix);
    expect(prefix).toMatch(/^[a-z0-9][a-z0-9-]{0,36}$/);
    expect(value(main ?? [], 'bucket')).toBeUndefined();
  });

  it('sem aresta, a política só nega tráfego sem TLS', () => {
    const [deny, ...rest] = statements(nodes, 'meu_bucket');
    expect(rest).toEqual([]);
    expect(plain(value(deny ?? [], 'effect'))).toBe('Deny');
    expect(plain(value(deny ?? [], 'actions'))).toEqual(['s3:*']);
    expect(value(deny ?? [], 'resources')).toEqual(hcl.list([arn, objects]));
    const condition = body(deny ?? [], 'condition');
    expect(plain(value(condition, 'variable'))).toBe('aws:SecureTransport');
    expect(plain(value(condition, 'values'))).toEqual(['false']);
    const policy = body(nodes, 'resource', 'aws_s3_bucket_policy', 'meu_bucket');
    expect(value(policy, 'policy')).toEqual(
      hcl.ref('data', 'aws_iam_policy_document', 'meu_bucket', 'json'),
    );
  });

  it('CloudFront ligado por aresta de dados lê só pelo serviço, condicionado à distribuição', () => {
    const linked = generate([bucket, cdn], [['cdn', 'b']]);
    const [, allow, ...rest] = statements(linked, 'meu_bucket');
    expect(rest).toEqual([]);
    expect(plain(value(allow ?? [], 'effect'))).toBe('Allow');
    expect(plain(value(allow ?? [], 'actions'))).toEqual(['s3:GetObject']);
    expect(value(allow ?? [], 'resources')).toEqual(hcl.list([objects]));
    const principals = body(allow ?? [], 'principals');
    expect(plain(value(principals, 'type'))).toBe('Service');
    expect(plain(value(principals, 'identifiers'))).toEqual(['cloudfront.amazonaws.com']);
    const condition = body(allow ?? [], 'condition');
    expect(plain(value(condition, 'variable'))).toBe('AWS:SourceArn');
    expect(value(condition, 'values')).toEqual(
      hcl.list([hcl.ref('aws_cloudfront_distribution', 'cdn', 'arn')]),
    );
  });

  it('dois CloudFront no mesmo bucket viram duas liberações, uma por distribuição', () => {
    const edges = [
      ['cdn', 'b'],
      ['cdn2', 'b'],
    ] as const;
    const [, ...allows] = statements(
      generate([bucket, cdn, { ...cdn, id: 'cdn2' }], edges),
      'meu_bucket',
    );
    expect(allows.map((allow) => value(body(allow, 'condition'), 'values'))).toEqual([
      hcl.list([hcl.ref('aws_cloudfront_distribution', 'cdn2', 'arn')]),
      hcl.list([hcl.ref('aws_cloudfront_distribution', 'cdn', 'arn')]),
    ]);
  });

  it.each([
    ['aresta no sentido contrário', [['b', 'cdn']] as const],
    ['aresta de logs', [['cdn', 'b', 'logs']] as const],
    ['aresta para a internet', [['b', 'client']] as const],
  ])('%s não abre o bucket', (_name, edges) => {
    expect(statements(generate([bucket, cdn], edges), 'meu_bucket')).toHaveLength(1);
  });

  it('Standard-IA vira regra de ciclo de vida; Standard não gera regra', () => {
    const ia = generate([{ ...bucket, attributes: { storageClass: 'STANDARD_IA' } }]);
    const lifecycle = body(ia, 'resource', 'aws_s3_bucket_lifecycle_configuration', 'meu_bucket');
    const transition = body(body(lifecycle, 'rule'), 'transition');
    expect(plain(value(transition, 'storage_class'))).toBe('STANDARD_IA');
    expect(plain(value(transition, 'days'))).toBe(30);
    expect(resourceTypes(nodes)).not.toContain('aws_s3_bucket_lifecycle_configuration');
  });

  it('atributo fora do contrato recusa o bloco', () => {
    const text = mainTf(design([{ ...bucket, attributes: { storageClass: 'GLACIER"\n' } }]));
    expect(text).toContain('# - aws.s3 "Meu Bucket": atributo fora das opções do contrato');
    expect(text).not.toContain('resource "aws_s3_bucket"');
  });
});
