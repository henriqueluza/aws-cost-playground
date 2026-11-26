import type { BlockGenerator } from '../generator';
import { hcl, type HclNode } from '../hcl';
import { dataPeers } from './links';

const READ_METHODS = hcl.list([hcl.string('GET'), hcl.string('HEAD')]);

/**
 * Distribuição com HTTPS obrigatório e o certificado padrão do CloudFront (o design não tem domínio).
 * Cada bucket S3 ligado por aresta de dados vira origem privada, lida por Origin Access Control; a
 * política que libera a leitura sai do gerador do S3. Sem bucket ligado, a origem é uma variável.
 */
export const cloudfront: BlockGenerator = ({ block, links }) => {
  const { name } = block;
  const buckets = dataPeers(links, 'source', 'aws.s3');
  const originVariable = `${name}__origin_domain`;

  const origins: HclNode[] = buckets.map((bucket) =>
    hcl.block(
      'origin',
      [],
      [
        hcl.attr(
          'domain_name',
          hcl.ref('aws_s3_bucket', bucket.name, 'bucket_regional_domain_name'),
        ),
        hcl.attr('origin_id', hcl.string(bucket.name)),
        hcl.attr(
          'origin_access_control_id',
          hcl.ref('aws_cloudfront_origin_access_control', name, 'id'),
        ),
      ],
    ),
  );
  if (origins.length === 0) {
    origins.push(
      hcl.block(
        'origin',
        [],
        [
          hcl.attr('domain_name', hcl.ref('var', originVariable)),
          hcl.attr('origin_id', hcl.string('origin')),
          hcl.block(
            'custom_origin_config',
            [],
            [
              hcl.attr('http_port', hcl.number(80)),
              hcl.attr('https_port', hcl.number(443)),
              hcl.attr('origin_protocol_policy', hcl.string('https-only')),
              hcl.attr('origin_ssl_protocols', hcl.list([hcl.string('TLSv1.2')])),
            ],
          ),
        ],
      ),
    );
  }

  const access: HclNode[] =
    buckets.length > 0
      ? [
          hcl.block(
            'resource',
            ['aws_cloudfront_origin_access_control', name],
            [
              hcl.attr('name', hcl.string(name)),
              hcl.attr('origin_access_control_origin_type', hcl.string('s3')),
              hcl.attr('signing_behavior', hcl.string('always')),
              hcl.attr('signing_protocol', hcl.string('sigv4')),
            ],
          ),
        ]
      : [
          hcl.comment('Sem bucket S3 ligado por aresta de dados: informe o domínio da origem.'),
          hcl.block(
            'variable',
            [originVariable],
            [
              hcl.attr('description', hcl.string('Domínio da origem da distribuição (só HTTPS).')),
              hcl.attr('type', hcl.ref('string')),
            ],
          ),
        ];

  return {
    exported: true,
    nodes: [
      hcl.comment(
        'Só bucket S3 ligado por aresta de dados vira origem; as demais ficam por sua conta.',
      ),
      hcl.comment('O comportamento padrão aponta para a primeira origem.'),
      hcl.comment(
        'Com o certificado padrão a AWS fixa o TLS mínimo do visitante; use um seu para TLSv1.2_2021.',
      ),
      hcl.block(
        'data',
        ['aws_cloudfront_cache_policy', name],
        [hcl.attr('name', hcl.string('Managed-CachingOptimized'))],
      ),
      ...access,
      hcl.block(
        'resource',
        ['aws_cloudfront_distribution', name],
        [
          hcl.attr('enabled', hcl.bool(true)),
          hcl.attr('is_ipv6_enabled', hcl.bool(true)),
          ...(buckets.length > 0
            ? [hcl.attr('default_root_object', hcl.string('index.html'))]
            : []),
          ...origins,
          hcl.block(
            'default_cache_behavior',
            [],
            [
              hcl.attr('target_origin_id', hcl.string(buckets[0]?.name ?? 'origin')),
              hcl.attr('viewer_protocol_policy', hcl.string('redirect-to-https')),
              hcl.attr('allowed_methods', READ_METHODS),
              hcl.attr('cached_methods', READ_METHODS),
              hcl.attr(
                'cache_policy_id',
                hcl.ref('data', 'aws_cloudfront_cache_policy', name, 'id'),
              ),
              hcl.attr('compress', hcl.bool(true)),
            ],
          ),
          hcl.block(
            'restrictions',
            [],
            [hcl.block('geo_restriction', [], [hcl.attr('restriction_type', hcl.string('none'))])],
          ),
          hcl.block(
            'viewer_certificate',
            [],
            [hcl.attr('cloudfront_default_certificate', hcl.bool(true))],
          ),
        ],
      ),
    ],
  };
};
