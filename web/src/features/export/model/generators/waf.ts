import type { BlockGenerator, ExportBlock } from '../generator';
import { hcl, type HclNode } from '../hcl';
import { ordinalId } from './network';

/** Grupos de regras gerenciados pela AWS, sem assinatura paga, na ordem em que são avaliados. */
const MANAGED_GROUPS = [
  'AWSManagedRulesAmazonIpReputationList',
  'AWSManagedRulesKnownBadInputsRuleSet',
  'AWSManagedRulesCommonRuleSet',
] as const;

const visibility = (metric: string): HclNode =>
  hcl.block(
    'visibility_config',
    [],
    [
      hcl.attr('cloudwatch_metrics_enabled', hcl.bool(true)),
      hcl.attr('metric_name', hcl.string(metric)),
      hcl.attr('sampled_requests_enabled', hcl.bool(true)),
    ],
  );

const managedRule = (group: string, priority: number): HclNode =>
  hcl.block(
    'rule',
    [],
    [
      hcl.attr('name', hcl.string(group)),
      hcl.attr('priority', hcl.number(priority)),
      // `none` mantém a ação do grupo, que é bloquear. Para só contar, troque por `count {}`.
      hcl.block('override_action', [], [hcl.block('none', [], [])]),
      hcl.block(
        'statement',
        [],
        [
          hcl.block(
            'managed_rule_group_statement',
            [],
            [hcl.attr('name', hcl.string(group)), hcl.attr('vendor_name', hcl.string('AWS'))],
          ),
        ],
      ),
      visibility(group),
    ],
  );

/**
 * WAF: uma web ACL regional que deixa passar por padrão e bloqueia o que os grupos gerenciados da
 * AWS reconhecem. Ela é associada a cada ALB ligado por aresta de dados; um ALB só aceita uma web
 * ACL, então ele fica com o primeiro bloco de WAF, na ordem do id, que se liga a ele.
 */
export const waf: BlockGenerator = (input) => {
  const { block, links } = input;
  const id = ordinalId(input, 'waf');
  const groups = MANAGED_GROUPS.slice(0, Math.max(0, block.usage.rules ?? 0));
  const balancers = new Map<string, ExportBlock>();
  for (const { kind, peer } of links) {
    if (kind === 'data' && peer?.type === 'aws.alb') balancers.set(peer.id, peer);
  }
  const owns = (balancer: ExportBlock) =>
    input.blocks.find(
      (candidate) =>
        candidate.type === 'aws.waf' &&
        (input.designLinks.get(candidate.id) ?? []).some(
          (link) => link.kind === 'data' && link.peer?.id === balancer.id,
        ),
    )?.id === block.id;
  const mine = [...balancers.values()].filter(owns);
  return {
    exported: true,
    nodes: [
      hcl.comment('Web ACL regional (para ALB). As regras são grupos gerenciados da AWS, em modo'),
      hcl.comment('de bloqueio; o design só diz quantas regras existem, não quais.'),
      hcl.comment(
        'Proteger um CloudFront exige outra web ACL, de escopo CLOUDFRONT, em us-east-1.',
      ),
      ...(mine.length === 0
        ? [hcl.comment('Nenhum ALB associado: a web ACL não protege nada até ser associada.')]
        : []),
      ...(mine.length < balancers.size
        ? [hcl.comment('Um ALB ligado já tem a web ACL de outro bloco de WAF e não é associado.')]
        : []),
      hcl.block(
        'resource',
        ['aws_wafv2_web_acl', block.name],
        [
          hcl.attr('name', hcl.string(id)),
          hcl.attr('scope', hcl.string('REGIONAL')),
          hcl.block('default_action', [], [hcl.block('allow', [], [])]),
          ...groups.map(managedRule),
          visibility(id),
        ],
      ),
      ...mine.map((balancer, i) =>
        hcl.block(
          'resource',
          ['aws_wafv2_web_acl_association', `${block.name}__alb_${i + 1}`],
          [
            hcl.attr('resource_arn', hcl.ref('aws_lb', balancer.name, 'arn')),
            hcl.attr('web_acl_arn', hcl.ref('aws_wafv2_web_acl', block.name, 'arn')),
          ],
        ),
      ),
    ],
  };
};
