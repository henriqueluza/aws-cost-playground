import { design } from './generatorHarness';

/**
 * Design de teste com os blocos de nível B e C (#67) e os blocos em VPC a que eles se ligam.
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
  ],
  [
    ['dns', 'lb'],
    ['lb', 'web'],
    ['web', 'cofre'],
    ['papel', 'logs', 'logs'],
    ['stack', 'logs', 'logs'],
  ],
);
