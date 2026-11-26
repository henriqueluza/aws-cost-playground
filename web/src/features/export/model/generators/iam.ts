import type { BlockType } from '../../../pricing';
import type { BlockGenerator } from '../generator';
import { hcl } from '../hcl';
import { policyDocument, policyJson } from './policyDocument';

/** Serviços de computação do design que podem assumir o papel, em ordem fixa. */
const TRUSTED_SERVICES: readonly (readonly [BlockType, string])[] = [
  ['aws.ec2', 'ec2.amazonaws.com'],
  ['aws.ecs', 'ecs-tasks.amazonaws.com'],
  ['aws.lambda', 'lambda.amazonaws.com'],
];

/**
 * IAM: um papel sem nenhuma permissão. O contrato do bloco não tem atributo, uso nem aresta de
 * dados, então o design não diz o que o papel acessa: nenhuma ação e nenhum recurso são inventados,
 * e não há curinga. A confiança sai dos blocos de computação do design; sem nenhum, só a própria
 * conta pode assumir o papel.
 */
export const iam: BlockGenerator = ({ block, blocks }) => {
  const services = TRUSTED_SERVICES.filter(([type]) =>
    blocks.some((candidate) => candidate.type === type),
  ).map(([, service]) => service);
  const assume = `${block.name}__assume`;
  return {
    exported: true,
    nodes: [
      hcl.comment('Papel sem permissões: o design não diz o que ele acessa, e nada é inventado.'),
      hcl.comment('Ao dar acesso, liste cada ação e o ARN de cada recurso. Nunca use curinga.'),
      ...(services.length === 0
        ? [
            hcl.comment('Sem bloco de computação no design: só a própria conta assume o papel.'),
            hcl.block('data', ['aws_caller_identity', block.name], []),
          ]
        : []),
      policyDocument(assume, [
        {
          actions: ['sts:AssumeRole'],
          principal:
            services.length > 0
              ? { type: 'Service', identifiers: services }
              : {
                  type: 'AWS',
                  identifiers: [hcl.ref('data', 'aws_caller_identity', block.name, 'account_id')],
                },
        },
      ]),
      hcl.block(
        'resource',
        ['aws_iam_role', block.name],
        [
          hcl.attr('description', hcl.string('Papel do design, sem permissoes anexadas')),
          hcl.attr('assume_role_policy', policyJson(assume)),
        ],
      ),
    ],
  };
};
