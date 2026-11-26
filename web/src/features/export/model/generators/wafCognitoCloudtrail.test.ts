import { describe, expect, it } from 'vitest';
import { attrs, blocksOf, named } from '../../test/generatorKit';
import {
  bodies,
  body,
  generate,
  plain,
  resourceTypes,
  statements,
  value,
} from '../../test/generatorHarness';
import { allowedWildcards, SENSITIVE_LITERAL } from '../../test/securityAssertions';
import { renderHcl } from '../hcl';

describe('gerador de WAF', () => {
  const nodes = generate(
    [
      { id: 'waf', type: 'aws.waf', usage: { rules: 10 } },
      { id: 'lb', type: 'aws.alb' },
      { id: 'outro', type: 'aws.alb' },
      { id: 'waf2', type: 'aws.waf', usage: { rules: 2 } },
      { id: 'waf3', type: 'aws.waf', usage: { rules: 0 } },
      { id: 'logs', type: 'aws.cloudwatch' },
      { id: 'cdn', type: 'aws.cloudfront' },
    ],
    [
      ['waf', 'lb'],
      ['lb', 'waf'],
      ['waf2', 'lb'],
      ['waf2', 'outro'],
      ['waf3', 'logs', 'logs'],
      ['waf3', 'cdn'],
    ],
  );
  const rules = (name: string) =>
    bodies(body(nodes, 'resource', 'aws_wafv2_web_acl', name), 'rule');

  it('gera a web ACL regional que libera por padrão, com métricas', () => {
    const acl = body(nodes, 'resource', 'aws_wafv2_web_acl', 'waf');
    expect(plain(value(acl, 'name'))).toBe('waf-1');
    expect(plain(value(acl, 'scope'))).toBe('REGIONAL');
    expect(renderHcl(bodies(acl, 'default_action')[0] ?? [])).toBe('allow {}\n');
    expect(attrs(named(nodes, 'aws_wafv2_web_acl', 'waf'))).toMatchObject({
      'visibility_config.cloudwatch_metrics_enabled': 'true',
      'visibility_config.metric_name': '"waf-1"',
    });
  });

  it('usa só grupos gerenciados da AWS, em modo de bloqueio, no máximo quantas regras o design tem', () => {
    expect(rules('waf').map((rule) => plain(value(rule, 'name')))).toEqual([
      'AWSManagedRulesAmazonIpReputationList',
      'AWSManagedRulesKnownBadInputsRuleSet',
      'AWSManagedRulesCommonRuleSet',
    ]);
    expect(rules('waf').map((rule) => plain(value(rule, 'priority')))).toEqual([0, 1, 2]);
    for (const rule of rules('waf')) {
      expect(renderHcl(bodies(rule, 'override_action')[0] ?? [])).toBe('none {}\n');
      const [statement = []] = bodies(rule, 'statement');
      expect(attrs(blocksOf(statement, undefined, 'managed_rule_group_statement')[0]!)).toEqual({
        name: `"${String(plain(value(rule, 'name')))}"`,
        vendor_name: '"AWS"',
      });
    }
    expect(rules('waf2')).toHaveLength(2);
    expect(rules('waf3')).toHaveLength(0);
    // Sem `rules` no design vale o padrão do contrato (5), que cobre os três grupos.
    const defaults = generate([{ id: 'waf', type: 'aws.waf' }]);
    expect(bodies(body(defaults, 'resource', 'aws_wafv2_web_acl', 'waf'), 'rule')).toHaveLength(3);
  });

  it('associa cada ALB ligado a uma só web ACL: a do primeiro bloco de WAF', () => {
    const associations = blocksOf(nodes, 'aws_wafv2_web_acl_association');
    expect(associations.map((node) => [node.labels[1], attrs(node)])).toEqual([
      ['waf__alb_1', { resource_arn: 'aws_lb.lb.arn', web_acl_arn: 'aws_wafv2_web_acl.waf.arn' }],
      [
        'waf2__alb_1',
        { resource_arn: 'aws_lb.outro.arn', web_acl_arn: 'aws_wafv2_web_acl.waf2.arn' },
      ],
    ]);
    const text = renderHcl(nodes);
    expect(text.match(/# Um ALB ligado já tem a web ACL de outro bloco/g)).toHaveLength(1);
    expect(text.match(/# Nenhum ALB associado/g)).toHaveLength(1);
  });
});

describe('gerador de Cognito', () => {
  const nodes = generate([
    { id: 'login', type: 'aws.cognito' },
    { id: 'plus', type: 'aws.cognito', attributes: { tier: 'plus' } },
  ]);

  it('gera o pool com política de senha, MFA disponível e proteção contra exclusão', () => {
    expect(attrs(named(nodes, 'aws_cognito_user_pool', 'login'))).toEqual({
      name: '"usuarios-1"',
      user_pool_tier: '"ESSENTIALS"',
      username_attributes: '["email"]',
      auto_verified_attributes: '["email"]',
      mfa_configuration: '"OPTIONAL"',
      deletion_protection: '"ACTIVE"',
      'password_policy.minimum_length': '12',
      'password_policy.require_lowercase': 'true',
      'password_policy.require_uppercase': 'true',
      'password_policy.require_numbers': 'true',
      'password_policy.require_symbols': 'true',
      'password_policy.temporary_password_validity_days': '7',
      'software_token_mfa_configuration.enabled': 'true',
      'account_recovery_setting.recovery_mechanism.name': '"verified_email"',
      'account_recovery_setting.recovery_mechanism.priority': '1',
    });
  });

  it('liga a proteção contra ameaças só no nível Plus', () => {
    expect(attrs(named(nodes, 'aws_cognito_user_pool', 'plus'))).toMatchObject({
      name: '"usuarios-2"',
      user_pool_tier: '"PLUS"',
      'user_pool_add_ons.advanced_security_mode': '"ENFORCED"',
    });
  });

  it('o cliente não tem segredo, só aceita SRP e não revela se o usuário existe', () => {
    expect(attrs(named(nodes, 'aws_cognito_user_pool_client', 'login'))).toEqual({
      name: '"usuarios-1-app"',
      user_pool_id: 'aws_cognito_user_pool.login.id',
      generate_secret: 'false',
      explicit_auth_flows: '["ALLOW_USER_SRP_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"]',
      prevent_user_existence_errors: '"ENABLED"',
      enable_token_revocation: 'true',
    });
    const text = renderHcl(nodes);
    expect(text).not.toMatch(SENSITIVE_LITERAL);
    expect(text).not.toMatch(/ALLOW_USER_PASSWORD_AUTH|ALLOW_ADMIN_USER_PASSWORD_AUTH|sms_/);
  });
});

describe('gerador de CloudTrail', () => {
  const nodes = generate([
    { id: 'trilha', type: 'aws.cloudtrail', usage: { trails: 3, dataEventsPerMonth: 10 } },
  ]);
  const logs = 'aws_s3_bucket.trilha__logs';

  it('gera a trilha de todas as regiões, com validação de log, depois da política do bucket', () => {
    expect(attrs(named(nodes, 'aws_cloudtrail', 'trilha'))).toEqual({
      name: '"trilha-1"',
      s3_bucket_name: `${logs}.id`,
      is_multi_region_trail: 'true',
      include_global_service_events: 'true',
      enable_log_file_validation: 'true',
      depends_on: '[aws_s3_bucket_policy.trilha__logs]',
    });
    expect(resourceTypes(nodes, 'trilha')).toEqual([
      'aws_s3_bucket',
      'aws_s3_bucket_public_access_block',
      'aws_s3_bucket_server_side_encryption_configuration',
      'aws_s3_bucket_policy',
      'aws_cloudtrail',
    ]);
  });

  it('o bucket de logs é privado e criptografado, e avisa do custo', () => {
    expect(attrs(named(nodes, 'aws_s3_bucket', 'trilha__logs'))).toEqual({
      bucket_prefix: '"trilha-1-logs-"',
    });
    expect(attrs(named(nodes, 'aws_s3_bucket_public_access_block', 'trilha__logs'))).toEqual({
      bucket: `${logs}.id`,
      block_public_acls: 'true',
      block_public_policy: 'true',
      ignore_public_acls: 'true',
      restrict_public_buckets: 'true',
    });
    expect(
      attrs(named(nodes, 'aws_s3_bucket_server_side_encryption_configuration', 'trilha__logs')),
    ).toEqual({
      bucket: `${logs}.id`,
      'rule.apply_server_side_encryption_by_default.sse_algorithm': '"AES256"',
    });
    expect(renderHcl(nodes)).toContain('# Custo: o bucket dos logs cobra armazenamento');
  });

  it('a política só deixa esta trilha escrever, exige TLS e não tem curinga além do nome do objeto', () => {
    const [acl = [], put = [], tls = []] = statements(nodes, 'trilha__logs');
    const sourceArn =
      'format("arn:%s:cloudtrail:%s:%s:trail/trilha-1", data.aws_partition.trilha.partition, var.aws_region, data.aws_caller_identity.trilha.account_id)';
    for (const [statement, action] of [
      [acl, 's3:GetBucketAcl'],
      [put, 's3:PutObject'],
    ] as const) {
      expect(plain(value(statement, 'actions'))).toEqual([action]);
      expect(attrs(blocksOf(statement, undefined, 'principals')[0]!)).toEqual({
        type: '"Service"',
        identifiers: '["cloudtrail.amazonaws.com"]',
      });
      expect(attrs(blocksOf(statement, undefined, 'condition')[0]!)).toEqual({
        test: '"StringEquals"',
        variable: '"aws:SourceArn"',
        values: `[${sourceArn}]`,
      });
    }
    expect(renderHcl(acl)).toContain(`resources = [${logs}.arn]`);
    expect(plain(value(tls, 'effect'))).toBe('Deny');
    expect(attrs(blocksOf(tls, undefined, 'condition')[0]!)).toEqual({
      test: '"Bool"',
      variable: '"aws:SecureTransport"',
      values: '["false"]',
    });
    expect(renderHcl(tls)).toContain(`resources = [${logs}.arn, format("%s/*", ${logs}.arn)]`);
    expect(allowedWildcards(nodes)).toEqual([
      `format("%s/AWSLogs/%s/*", ${logs}.arn, data.aws_caller_identity.trilha.account_id)`,
    ]);
    expect(attrs(named(nodes, 'aws_s3_bucket_policy', 'trilha__logs'))).toEqual({
      bucket: `${logs}.id`,
      policy: 'data.aws_iam_policy_document.trilha__logs.json',
      depends_on: '[aws_s3_bucket_public_access_block.trilha__logs]',
    });
  });
});
