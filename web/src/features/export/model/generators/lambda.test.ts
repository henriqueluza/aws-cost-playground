import { describe, expect, it } from 'vitest';
import { hcl, renderHcl } from '../hcl';
import {
  body,
  bodies,
  describeReferenceScenarios,
  design,
  generate,
  mainTf,
  plain,
  resourceTypes,
  statements,
  value,
} from '../../test/generatorHarness';

const fn = {
  id: 'fn',
  type: 'aws.lambda',
  label: 'Worker',
  attributes: { architecture: 'x86_64', memoryMb: 1024 },
};
const queue = { id: 'q', type: 'aws.sqs' };
const table = { id: 't', type: 'aws.dynamodb' };
const bucket = { id: 'b', type: 'aws.s3' };
const logs = { id: 'logs', type: 'aws.cloudwatch' };
const objects = hcl.call('format', [hcl.string('%s/*'), hcl.ref('aws_s3_bucket', 'b', 'arn')]);
const grants = (nodes: ReturnType<typeof generate>) =>
  statements(nodes, 'worker').map((statement) => [
    plain(value(statement, 'actions')),
    value(statement, 'resources'),
  ]);
const ownLogs = [
  ['logs:CreateLogStream', 'logs:PutLogEvents'],
  hcl.list([
    hcl.call('format', [hcl.string('%s:*'), hcl.ref('aws_cloudwatch_log_group', 'worker', 'arn')]),
  ]),
];

describe('gerador do Lambda', () => {
  const nodes = generate([fn]);
  const lambda = body(nodes, 'resource', 'aws_lambda_function', 'worker');

  it('gera a função com os atributos do design, papel próprio e grupo de logs com retenção', () => {
    expect(resourceTypes(nodes, 'worker')).toEqual([
      'aws_cloudwatch_log_group',
      'aws_iam_role',
      'aws_iam_role_policy',
      'aws_lambda_function',
    ]);
    expect(plain(value(lambda, 'architectures'))).toEqual(['x86_64']);
    expect(plain(value(lambda, 'memory_size'))).toBe(1024);
    expect(value(lambda, 'role')).toEqual(hcl.ref('aws_iam_role', 'worker', 'arn'));
    const group = body(nodes, 'resource', 'aws_cloudwatch_log_group', 'worker');
    expect(plain(value(group, 'name'))).toBe('/aws/lambda/worker');
    expect(plain(value(group, 'retention_in_days'))).toBe(30);
    expect(value(body(lambda, 'logging_config'), 'log_group')).toEqual(
      hcl.ref('aws_cloudwatch_log_group', 'worker', 'name'),
    );
    const assume = statements(nodes, 'worker__assume');
    expect(assume).toHaveLength(1);
    expect(plain(value(body(assume[0] ?? [], 'principals'), 'identifiers'))).toEqual([
      'lambda.amazonaws.com',
    ]);
  });

  it('o pacote vem de variável sem padrão e não há variável de ambiente', () => {
    const variable = body(nodes, 'variable', 'worker__package');
    expect(value(variable, 'default')).toBeUndefined();
    expect(value(lambda, 'filename')).toEqual(hcl.ref('var', 'worker__package'));
    expect(bodies(lambda, 'environment')).toEqual([]);
    expect(renderHcl(nodes)).not.toMatch(/environment|password|secret|token/i);
  });

  it.each([
    [1, 3],
    [800, 3],
    [20_000, 60],
    [900_000, 900],
  ])('duração média de %d ms dá tempo limite de %d s', (avgDurationMs, timeout) => {
    const sized = generate([{ ...fn, usage: { avgDurationMs } }]);
    expect(plain(value(body(sized, 'resource', 'aws_lambda_function', 'worker'), 'timeout'))).toBe(
      timeout,
    );
  });

  it('sem aresta, o papel só escreve no próprio grupo de logs', () => {
    expect(grants(nodes)).toEqual([ownLogs]);
    expect(grants(generate([fn, logs], [['fn', 'logs', 'logs']]))).toEqual([ownLogs]);
    expect(resourceTypes(nodes)).not.toContain('aws_lambda_event_source_mapping');
  });

  it('fila que aponta para a função vira origem de evento, com a permissão de leitura', () => {
    const linked = generate([fn, queue], [['q', 'fn']]);
    const queueArn = hcl.ref('aws_sqs_queue', 'q', 'arn');
    const mapping = body(linked, 'resource', 'aws_lambda_event_source_mapping', 'worker__sqs_1');
    expect(value(mapping, 'event_source_arn')).toEqual(queueArn);
    expect(value(mapping, 'function_name')).toEqual(
      hcl.ref('aws_lambda_function', 'worker', 'arn'),
    );
    expect(value(mapping, 'depends_on')).toEqual(
      hcl.list([hcl.ref('aws_iam_role_policy', 'worker')]),
    );
    expect(grants(linked)).toEqual([
      ownLogs,
      [['sqs:ReceiveMessage', 'sqs:DeleteMessage', 'sqs:GetQueueAttributes'], hcl.list([queueArn])],
    ]);
  });

  it('cada destino dá só as ações necessárias no ARN do recurso ligado', () => {
    const edges = [
      ['fn', 'q'],
      ['fn', 't'],
      ['fn', 'b'],
      ['fn', 'b'],
    ] as const;
    const linked = generate([fn, queue, table, bucket], edges);
    expect(grants(linked)).toEqual([
      ownLogs,
      [['sqs:SendMessage'], hcl.list([hcl.ref('aws_sqs_queue', 'q', 'arn')])],
      [
        [
          'dynamodb:GetItem',
          'dynamodb:Query',
          'dynamodb:PutItem',
          'dynamodb:UpdateItem',
          'dynamodb:DeleteItem',
        ],
        hcl.list([hcl.ref('aws_dynamodb_table', 't', 'arn')]),
      ],
      [['s3:GetObject', 's3:PutObject'], hcl.list([objects])],
    ]);
    expect(resourceTypes(linked)).not.toContain('aws_lambda_event_source_mapping');
  });

  it('bucket que aponta para a função dá só leitura; tabela que aponta não dá nada', () => {
    const edges = [
      ['b', 'fn'],
      ['t', 'fn'],
    ] as const;
    expect(grants(generate([fn, bucket, table], edges))).toEqual([
      ownLogs,
      [['s3:GetObject'], hcl.list([objects])],
    ]);
  });

  it('nenhuma permissão usa curinga em ação nem em recurso', () => {
    const everything = [
      ['q', 'fn'],
      ['fn', 'q'],
      ['fn', 't'],
      ['fn', 'b'],
      ['b', 'fn'],
    ] as const;
    for (const [actions, resources] of grants(generate([fn, queue, table, bucket], everything))) {
      for (const action of actions as string[]) expect(action).toMatch(/^[a-z0-9]+:[A-Za-z]+$/);
      expect(plain(resources as never)).not.toContain('*');
    }
  });

  it('duas filas viram dois mapeamentos numerados', () => {
    const edges = [
      ['q', 'fn'],
      ['q2', 'fn'],
      ['q', 'fn'],
    ] as const;
    const linked = generate([fn, queue, { ...queue, id: 'q2' }], edges);
    expect(resourceTypes(linked).filter((type) => type.endsWith('mapping'))).toHaveLength(2);
    const second = body(linked, 'resource', 'aws_lambda_event_source_mapping', 'worker__sqs_2');
    expect(value(second, 'event_source_arn')).toEqual(hcl.ref('aws_sqs_queue', 'q', 'arn'));
  });

  it('fila recusada pelo contrato não deixa mapeamento nem permissão', () => {
    const broken = { ...queue, attributes: { queueType: 'x' } };
    const linked = generate([{ ...fn, label: 'y'.repeat(80) }, broken], [['q', 'fn']]);
    expect(renderHcl(linked)).not.toContain('aws_sqs_queue');
    expect(renderHcl(linked)).toContain(`variable "${'y'.repeat(48)}__package"`);
  });

  it('atributo fora do contrato recusa o bloco', () => {
    const text = mainTf(design([{ ...fn, attributes: { memoryMb: 999 } }]));
    expect(text).toContain('# - aws.lambda "Worker": atributo fora das opções do contrato');
    expect(text).not.toContain('resource "aws_lambda_function"');
  });
});

describeReferenceScenarios(['aws.lambda', 'aws.sqs', 'aws.dynamodb']);
