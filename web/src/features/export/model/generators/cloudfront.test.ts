import { describe, expect, it } from 'vitest';
import { hcl, renderHcl } from '../hcl';
import {
  body,
  bodies,
  describeReferenceScenarios,
  generate,
  plain,
  resourceTypes,
  value,
} from '../../test/generatorHarness';

const cdn = { id: 'cdn', type: 'aws.cloudfront', label: 'CDN' };
const site = { id: 'site', type: 'aws.s3' };
const media = { id: 'media', type: 'aws.s3' };
const distribution = (nodes: ReturnType<typeof generate>) =>
  body(nodes, 'resource', 'aws_cloudfront_distribution', 'cdn');

describe('gerador do CloudFront', () => {
  it('bucket ligado vira origem privada por Origin Access Control', () => {
    const nodes = generate([cdn, site], [['cdn', 'site']]);
    expect(resourceTypes(nodes, 'cdn')).toEqual([
      'aws_cloudfront_origin_access_control',
      'aws_cloudfront_distribution',
    ]);
    const control = body(nodes, 'resource', 'aws_cloudfront_origin_access_control', 'cdn');
    expect(plain(value(control, 'origin_access_control_origin_type'))).toBe('s3');
    expect(plain(value(control, 'signing_behavior'))).toBe('always');
    expect(plain(value(control, 'signing_protocol'))).toBe('sigv4');
    const origin = body(distribution(nodes), 'origin');
    expect(value(origin, 'domain_name')).toEqual(
      hcl.ref('aws_s3_bucket', 'site', 'bucket_regional_domain_name'),
    );
    expect(value(origin, 'origin_access_control_id')).toEqual(
      hcl.ref('aws_cloudfront_origin_access_control', 'cdn', 'id'),
    );
    expect(plain(value(origin, 'origin_id'))).toBe('site');
    expect(bodies(nodes, 'variable')).toEqual([]);
  });

  it('obriga HTTPS, usa o certificado padrão e não liga logging nem domínio próprio', () => {
    const nodes = generate([cdn, site], [['cdn', 'site']]);
    const behavior = body(distribution(nodes), 'default_cache_behavior');
    expect(plain(value(behavior, 'viewer_protocol_policy'))).toBe('redirect-to-https');
    expect(plain(value(behavior, 'target_origin_id'))).toBe('site');
    expect(plain(value(behavior, 'allowed_methods'))).toEqual(['GET', 'HEAD']);
    expect(value(behavior, 'cache_policy_id')).toEqual(
      hcl.ref('data', 'aws_cloudfront_cache_policy', 'cdn', 'id'),
    );
    const certificate = body(distribution(nodes), 'viewer_certificate');
    expect(certificate).toEqual([hcl.attr('cloudfront_default_certificate', hcl.bool(true))]);
    expect(renderHcl(nodes)).not.toMatch(/logging_config|aliases|allow-all|http-only|match-viewer/);
  });

  it('sem bucket ligado, a origem é uma variável sem padrão, só HTTPS com TLS 1.2', () => {
    const nodes = generate([cdn, site], [['site', 'cdn']]);
    expect(resourceTypes(nodes, 'cdn')).toEqual(['aws_cloudfront_distribution']);
    const variable = body(nodes, 'variable', 'cdn__origin_domain');
    expect(value(variable, 'default')).toBeUndefined();
    const origin = body(distribution(nodes), 'origin');
    expect(value(origin, 'domain_name')).toEqual(hcl.ref('var', 'cdn__origin_domain'));
    const custom = body(origin, 'custom_origin_config');
    expect(plain(value(custom, 'origin_protocol_policy'))).toBe('https-only');
    expect(plain(value(custom, 'origin_ssl_protocols'))).toEqual(['TLSv1.2']);
    const behavior = body(distribution(nodes), 'default_cache_behavior');
    expect(plain(value(behavior, 'target_origin_id'))).toBe('origin');
    expect(plain(value(behavior, 'viewer_protocol_policy'))).toBe('redirect-to-https');
  });

  it('bucket recusado pelo contrato não deixa referência, e o rótulo derivado cabe no limite', () => {
    const broken = { ...site, attributes: { storageClass: 'GLACIER' } };
    const nodes = generate([{ ...cdn, label: 'x'.repeat(80) }, broken], [['cdn', 'site']]);
    const text = renderHcl(nodes);
    expect(text).not.toContain('aws_s3_bucket');
    expect(text).toContain(`variable "${'x'.repeat(48)}__origin_domain"`);
  });

  it('dois buckets viram duas origens na ordem do id da aresta, sem repetir a duplicada', () => {
    const edges = [
      ['cdn', 'site'],
      ['cdn', 'media'],
      ['cdn', 'site'],
      ['cdn', 'client'],
    ] as const;
    const nodes = generate([cdn, site, media], edges);
    const origins = bodies(distribution(nodes), 'origin');
    expect(origins.map((origin) => plain(value(origin, 'origin_id')))).toEqual(['media', 'site']);
    const behavior = body(distribution(nodes), 'default_cache_behavior');
    expect(plain(value(behavior, 'target_origin_id'))).toBe('media');
  });
});

describeReferenceScenarios(['aws.s3', 'aws.cloudfront']);
