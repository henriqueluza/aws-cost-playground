import type { BlockType } from '../../../pricing';
import type { BlockGenerator, ExportBlock } from '../generator';
import { hcl, type HclValue } from '../hcl';
import { dataPeers } from './links';
import { policyDocument, policyJson, type PolicyStatement } from './policyDocument';

/** O design não tem runtime nem código: o export fixa um runtime atual e pede o pacote por variável. */
const RUNTIME = 'nodejs22.x';
const LOG_RETENTION_DAYS = 30;
const MAX_TIMEOUT_SECONDS = 900;

/** Tempo limite da função: três vezes a duração média do design, entre 3 s e o teto do Lambda. */
export const lambdaTimeoutSeconds = (block: ExportBlock): number =>
  Math.min(
    MAX_TIMEOUT_SECONDS,
    Math.max(3, Math.ceil(((block.usage.avgDurationMs ?? 0) * 3) / 1000)),
  );

type Arn = (name: string) => HclValue;
/** ARN do recurso ligado, sempre por referência. No S3 a permissão é sobre os objetos. */
const queueArn: Arn = (name) => hcl.ref('aws_sqs_queue', name, 'arn');
const tableArn: Arn = (name) => hcl.ref('aws_dynamodb_table', name, 'arn');
const objectsArn: Arn = (name) =>
  hcl.call('format', [hcl.string('%s/*'), hcl.ref('aws_s3_bucket', name, 'arn')]);
const TABLE_ACTIONS = ['GetItem', 'Query', 'PutItem', 'UpdateItem', 'DeleteItem'].map(
  (action) => `dynamodb:${action}`,
);
/**
 * Menor privilégio: só a aresta de dados dá permissão, e só estas ações no ARN do par.
 * `target`: a função é o destino (a fila a aciona, o bucket é lido); `source`: a função chama o par.
 */
const GRANTS: readonly (readonly ['source' | 'target', BlockType, Arn, readonly string[]])[] = [
  [
    'target',
    'aws.sqs',
    queueArn,
    ['sqs:ReceiveMessage', 'sqs:DeleteMessage', 'sqs:GetQueueAttributes'],
  ],
  ['target', 'aws.s3', objectsArn, ['s3:GetObject']],
  ['source', 'aws.sqs', queueArn, ['sqs:SendMessage']],
  ['source', 'aws.dynamodb', tableArn, TABLE_ACTIONS],
  ['source', 'aws.s3', objectsArn, ['s3:GetObject', 's3:PutObject']],
];

/**
 * Função com papel de execução próprio, grupo de logs com retenção e, para cada fila que aponta
 * para ela, o mapeamento de origem de evento. Não há variável de ambiente: segredo não entra aqui.
 */
export const lambda: BlockGenerator = ({ block, links }) => {
  const { name } = block;
  const assume = `${name}__assume`;
  const packageVariable = `${name}__package`;
  const logGroup = (attribute: string) => hcl.ref('aws_cloudwatch_log_group', name, attribute);
  const functionArn = hcl.ref('aws_lambda_function', name, 'arn');

  const grants: PolicyStatement[] = GRANTS.flatMap(([role, type, arn, actions]) =>
    dataPeers(links, role, type).map((peer) => ({ actions, resources: [arn(peer.name)] })),
  );
  const queues = dataPeers(links, 'target', 'aws.sqs');

  return {
    exported: true,
    nodes: [
      hcl.comment('Ponto de partida: o design não tem o código nem o runtime da função.'),
      hcl.comment(`Informe o pacote .zip em var.${packageVariable} e ajuste runtime e handler.`),
      hcl.block(
        'variable',
        [packageVariable],
        [
          hcl.attr('description', hcl.string('Caminho do pacote .zip com o código da função.')),
          hcl.attr('type', hcl.ref('string')),
        ],
      ),
      hcl.block(
        'resource',
        ['aws_cloudwatch_log_group', name],
        [
          hcl.attr('name', hcl.string(`/aws/lambda/${name}`)),
          hcl.attr('retention_in_days', hcl.number(LOG_RETENTION_DAYS)),
        ],
      ),
      policyDocument(assume, [
        {
          actions: ['sts:AssumeRole'],
          principal: { type: 'Service', identifiers: ['lambda.amazonaws.com'] },
        },
      ]),
      hcl.block(
        'resource',
        ['aws_iam_role', name],
        [hcl.attr('assume_role_policy', policyJson(assume))],
      ),
      policyDocument(name, [
        {
          actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
          resources: [hcl.call('format', [hcl.string('%s:*'), logGroup('arn')])],
        },
        ...grants,
      ]),
      hcl.block(
        'resource',
        ['aws_iam_role_policy', name],
        [
          hcl.attr('role', hcl.ref('aws_iam_role', name, 'id')),
          hcl.attr('policy', policyJson(name)),
        ],
      ),
      hcl.block(
        'resource',
        ['aws_lambda_function', name],
        [
          hcl.attr('function_name', hcl.string(name)),
          hcl.attr('role', hcl.ref('aws_iam_role', name, 'arn')),
          hcl.attr('runtime', hcl.string(RUNTIME)),
          hcl.attr('handler', hcl.string('index.handler')),
          hcl.attr('filename', hcl.ref('var', packageVariable)),
          hcl.attr('architectures', hcl.list([hcl.string(String(block.attributes.architecture))])),
          hcl.attr('memory_size', hcl.number(Number(block.attributes.memoryMb))),
          hcl.attr('timeout', hcl.number(lambdaTimeoutSeconds(block))),
          hcl.block(
            'logging_config',
            [],
            [hcl.attr('log_format', hcl.string('Text')), hcl.attr('log_group', logGroup('name'))],
          ),
        ],
      ),
      ...queues.map((queue, i) =>
        hcl.block(
          'resource',
          ['aws_lambda_event_source_mapping', `${name}__sqs_${i + 1}`],
          [
            hcl.attr('event_source_arn', queueArn(queue.name)),
            hcl.attr('function_name', functionArn),
            // A AWS confere a permissão de leitura da fila ao criar o mapeamento.
            hcl.attr('depends_on', hcl.list([hcl.ref('aws_iam_role_policy', name)])),
          ],
        ),
      ),
    ],
  };
};
