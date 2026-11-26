import { design } from './generatorHarness';

/**
 * Design de teste com os nove blocos de nível B e C (#67) e os blocos em VPC a que eles se ligam.
 * Fica aqui, e não em `contracts/scenarios/`, porque não é um cenário de referência do produto.
 */
export const levelBcDesign = design(
  [
    { id: 'dns', type: 'aws.route53', label: 'DNS público' },
    { id: 'lb', type: 'aws.alb', label: 'Balanceador' },
    { id: 'web', type: 'aws.ec2', label: 'Servidores', usage: { instanceCount: 2 } },
    { id: 'cofre', type: 'aws.secrets-manager', label: 'Cofre', usage: { secrets: 3 } },
    { id: 'papel', type: 'aws.iam', label: 'Papel da aplicação' },
    { id: 'stack', type: 'aws.cloudformation', label: 'Stack' },
    { id: 'logs', type: 'aws.cloudwatch', label: 'Logs' },
    { id: 'firewall', type: 'aws.waf', label: 'Firewall' },
    { id: 'login', type: 'aws.cognito', label: 'Login', attributes: { tier: 'plus' } },
    { id: 'auditoria', type: 'aws.cloudtrail', label: 'Auditoria' },
    {
      id: 'entrega',
      type: 'aws.codepipeline',
      label: 'Entrega',
      attributes: { pipelineType: 'V2' },
    },
    { id: 'cluster', type: 'aws.ecs', label: 'Contêineres' },
    {
      id: 'nos',
      type: 'aws.ec2',
      label: 'Nós do cluster',
      attributes: { instanceType: 't4g.small', az: 'b' },
    },
  ],
  [
    ['dns', 'lb'],
    ['lb', 'web'],
    ['web', 'cofre'],
    ['papel', 'logs', 'logs'],
    ['stack', 'logs', 'logs'],
    ['firewall', 'lb'],
    ['web', 'login'],
    ['auditoria', 'logs', 'logs'],
    ['cluster', 'nos', 'runs-on'],
    ['lb', 'nos'],
    ['entrega', 'logs', 'logs'],
  ],
);
