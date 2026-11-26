import { describe, expect, it } from 'vitest';
import { attrs, blocksOf, generate as kitGenerate, named } from '../../test/generatorKit';
import {
  code,
  generate,
  mainTf,
  plain,
  relabel,
  resourceTypes,
  statements,
  value,
} from '../../test/generatorHarness';
import { INJECTION_PAYLOADS } from '../../test/injectionPayloads';
import { levelBcDesign } from '../../test/levelBcDesign';
import { allowedWildcards, SENSITIVE_LITERAL } from '../../test/securityAssertions';
import { renderHcl } from '../hcl';

describe('gerador de Secrets Manager', () => {
  const nodes = generate(
    [
      { id: 'web', type: 'aws.ec2' },
      { id: 'cofre', type: 'aws.secrets-manager', usage: { secrets: 3 } },
      { id: 'vazio', type: 'aws.secrets-manager', usage: { secrets: 0 } },
    ],
    [
      ['web', 'cofre'],
      ['cofre', 'web'],
    ],
  );

  it('cria os segredos do design sem valor, com nome que não vem do rótulo', () => {
    expect(attrs(named(nodes, 'aws_secretsmanager_secret', 'cofre'))).toEqual({
      count: '3',
      name: 'format("aws-cost-playground/cofre-1/%d", count.index)',
      recovery_window_in_days: '30',
    });
    expect(attrs(named(nodes, 'aws_secretsmanager_secret', 'vazio'))).toMatchObject({
      count: '0',
      name: 'format("aws-cost-playground/cofre-2/%d", count.index)',
    });
    expect(renderHcl(nodes)).toContain('# Ligados ao cofre no design: aws.ec2 (web).');
  });

  it('não escreve valor, versão de segredo nem política de acesso', () => {
    const text = renderHcl(nodes);
    expect(resourceTypes(nodes, 'cofre')).toEqual(['aws_secretsmanager_secret']);
    expect(text).not.toMatch(
      /secret_string|secret_binary|aws_secretsmanager_secret_(version|policy)/,
    );
    expect(text).not.toMatch(SENSITIVE_LITERAL);
  });
});

describe('gerador de IAM', () => {
  const role = { id: 'papel', type: 'aws.iam' };
  const trust = (nodes: ReturnType<typeof generate>) => {
    const [statement = []] = statements(nodes, 'papel__assume');
    return { statement, principals: attrs(blocksOf(statement, undefined, 'principals')[0]!) };
  };

  it('confia só nos serviços de computação do design e não anexa permissão', () => {
    const nodes = generate([
      role,
      { id: 'fn', type: 'aws.lambda' },
      { id: 'web', type: 'aws.ec2' },
      { id: 'cluster', type: 'aws.ecs' },
      { id: 'fila', type: 'aws.sqs' },
    ]);
    expect(statements(nodes, 'papel__assume')).toHaveLength(1);
    expect(trust(nodes).principals).toEqual({
      type: '"Service"',
      identifiers: '["ec2.amazonaws.com", "ecs-tasks.amazonaws.com", "lambda.amazonaws.com"]',
    });
    expect(attrs(named(nodes, 'aws_iam_role', 'papel'))).toEqual({
      description: '"Papel do design, sem permissoes anexadas"',
      assume_role_policy: 'data.aws_iam_policy_document.papel__assume.json',
    });
    expect(resourceTypes(nodes, 'papel')).toEqual(['aws_iam_role']);
  });

  it('sem bloco de computação, quem assume o papel vem de uma variável sem padrão', () => {
    const nodes = generate([role, { id: 'cofre', type: 'aws.secrets-manager' }]);
    expect(trust(nodes).principals).toEqual({
      type: '"AWS"',
      identifiers: '[var.papel__trusted_arn]',
    });
    expect(Object.keys(attrs(blocksOf(nodes, 'papel__trusted_arn', 'variable')[0]!))).toEqual([
      'description',
      'type',
    ]);
    expect(renderHcl(nodes)).not.toMatch(/aws_caller_identity|:root/);
  });

  it('não tem `*` em ação nem em recurso, e nenhuma política de permissão', () => {
    for (const blocks of [[role], [role, { id: 'web', type: 'aws.ec2' }]]) {
      const nodes = generate(blocks);
      const text = renderHcl(nodes.filter((node) => node.kind !== 'comment'));
      expect(allowedWildcards(nodes)).toEqual([]);
      expect(plain(value(trust(nodes).statement, 'actions'))).toEqual(['sts:AssumeRole']);
      expect(text).not.toMatch(
        /aws_iam_(role_)?policy(_attachment)?"|managed_policy_arns|inline_policy/,
      );
    }
  });
});

describe('gerador de CloudFormation', () => {
  it('gera só comentário e conta como exportado', () => {
    const nodes = generate([{ id: 'stack', type: 'aws.cloudformation' }]);
    expect(nodes.length).toBeGreaterThan(0);
    expect(nodes.every((node) => node.kind === 'comment')).toBe(true);
    expect(renderHcl(nodes)).toContain('já é a infraestrutura como código');
    const text = mainTf(levelBcDesign);
    expect(text).not.toMatch(/^# - aws\.cloudformation /m);
    expect(text).not.toMatch(/aws_cloudformation_/);
  });
});

describe('gerador de Route 53', () => {
  const nodes = generate(
    [
      { id: 'dns', type: 'aws.route53', usage: { hostedZones: 3 } },
      { id: 'lb', type: 'aws.alb' },
      { id: 'outro', type: 'aws.alb' },
      { id: 'solto', type: 'aws.route53' },
    ],
    [
      ['dns', 'lb'],
      ['lb', 'dns'],
      ['dns', 'outro'],
    ],
  );

  it('cria a zona com o domínio de uma variável sem padrão', () => {
    expect(attrs(named(nodes, 'aws_route53_zone', 'dns'))).toEqual({ name: 'var.dns__domain' });
    expect(Object.keys(attrs(blocksOf(nodes, 'dns__domain', 'variable')[0]!))).toEqual([
      'description',
      'type',
    ]);
    expect(blocksOf(nodes, 'solto__domain', 'variable')).toHaveLength(1);
    expect(renderHcl(nodes)).toContain('# O design pede 3 zonas; só uma é gerada');
  });

  it('aponta o domínio só para o primeiro ALB ligado por aresta de dados', () => {
    expect(blocksOf(nodes, 'aws_route53_record').map((node) => node.labels[1])).toEqual([
      'dns__alb',
    ]);
    expect(attrs(named(nodes, 'aws_route53_record', 'dns__alb'))).toEqual({
      zone_id: 'aws_route53_zone.dns.zone_id',
      name: 'var.dns__domain',
      type: '"A"',
      'alias.name': 'aws_lb.lb.dns_name',
      'alias.zone_id': 'aws_lb.lb.zone_id',
      'alias.evaluate_target_health': 'true',
    });
  });
});

describe('export do design com os blocos de nível B e C', () => {
  const text = mainTf(levelBcDesign);

  it('exporta todos os blocos e não tem literal sensível no arquivo inteiro', () => {
    expect(text).toMatch(/^# Blocos exportados: 7 de 7\.$/m);
    expect(text).not.toMatch(SENSITIVE_LITERAL);
    expect(text).not.toMatch(/arn:aws|AKIA[0-9A-Z]{16}|-----BEGIN/);
    expect(allowedWildcards(kitGenerate(levelBcDesign))).toEqual([]);
  });

  it('é determinístico e não depende da ordem do documento', () => {
    const reversed = {
      ...levelBcDesign,
      blocks: [...levelBcDesign.blocks].reverse(),
      edges: [...levelBcDesign.edges].reverse(),
    };
    expect(mainTf(reversed)).toBe(text);
  });

  it.each(INJECTION_PAYLOADS)('rótulo com a carga "%s" só muda comentários', (_n, payload) => {
    const label = payload.slice(0, 80);
    const hostile = mainTf(relabel(levelBcDesign, label));
    expect(code(hostile)).toEqual(code(mainTf(relabel(levelBcDesign, label, true))));
    expect(hostile.replaceAll('\n', '')).not.toMatch(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}]/u);
  });
});
