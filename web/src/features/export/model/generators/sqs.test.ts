import { describe, expect, it } from 'vitest';
import { hcl } from '../hcl';
import {
  body,
  design,
  generate,
  mainTf,
  plain,
  resourceTypes,
  statements,
  value,
} from '../../test/generatorHarness';

const queue = { id: 'q', type: 'aws.sqs', label: 'Fila de avisos' };
const worker = (avgDurationMs: number) => ({
  id: 'fn',
  type: 'aws.lambda',
  usage: { avgDurationMs },
});
const main = (nodes: ReturnType<typeof generate>) =>
  body(nodes, 'resource', 'aws_sqs_queue', 'fila_de_avisos');

describe('gerador do SQS', () => {
  const nodes = generate([queue]);

  it('fila standard: criptografia gerenciada e política que nega chamada sem TLS', () => {
    expect(resourceTypes(nodes)).toEqual(['aws_sqs_queue', 'aws_sqs_queue_policy']);
    expect(plain(value(main(nodes), 'name'))).toBe('fila_de_avisos');
    expect(plain(value(main(nodes), 'sqs_managed_sse_enabled'))).toBe(true);
    expect(value(main(nodes), 'fifo_queue')).toBeUndefined();
    expect(value(main(nodes), 'visibility_timeout_seconds')).toBeUndefined();
    const [deny, ...rest] = statements(nodes, 'fila_de_avisos');
    expect(rest).toEqual([]);
    expect(plain(value(deny ?? [], 'effect'))).toBe('Deny');
    expect(value(deny ?? [], 'resources')).toEqual(
      hcl.list([hcl.ref('aws_sqs_queue', 'fila_de_avisos', 'arn')]),
    );
    expect(plain(value(body(deny ?? [], 'condition'), 'variable'))).toBe('aws:SecureTransport');
    const policy = body(nodes, 'resource', 'aws_sqs_queue_policy', 'fila_de_avisos');
    expect(value(policy, 'queue_url')).toEqual(hcl.ref('aws_sqs_queue', 'fila_de_avisos', 'url'));
    expect(value(policy, 'policy')).toEqual(
      hcl.ref('data', 'aws_iam_policy_document', 'fila_de_avisos', 'json'),
    );
  });

  it('fila FIFO leva o sufixo .fifo que a AWS exige', () => {
    const fifo = main(generate([{ ...queue, attributes: { queueType: 'fifo' } }]));
    expect(plain(value(fifo, 'name'))).toBe('fila_de_avisos.fifo');
    expect(plain(value(fifo, 'fifo_queue'))).toBe(true);
    expect(plain(value(fifo, 'sqs_managed_sse_enabled'))).toBe(true);
  });

  it.each([
    [400, 18],
    [20_000, 360],
    [900_000, 5400],
  ])('função de %d ms que consome a fila dá visibilidade de %d s', (avgDurationMs, seconds) => {
    const consumed = generate([queue, worker(avgDurationMs)], [['q', 'fn']]);
    expect(plain(value(main(consumed), 'visibility_timeout_seconds'))).toBe(seconds);
  });

  it('fila consumida por duas funções usa o maior tempo limite', () => {
    const edges = [
      ['q', 'fn'],
      ['q', 'slow'],
    ] as const;
    const consumed = generate([queue, worker(400), { ...worker(20_000), id: 'slow' }], edges);
    expect(plain(value(main(consumed), 'visibility_timeout_seconds'))).toBe(360);
  });

  it('função que só envia para a fila não muda a visibilidade', () => {
    const produced = generate([queue, worker(20_000)], [['fn', 'q']]);
    expect(value(main(produced), 'visibility_timeout_seconds')).toBeUndefined();
  });

  it('atributo fora do contrato recusa o bloco', () => {
    const text = mainTf(design([{ ...queue, attributes: { queueType: 'fifo.fifo' } }]));
    expect(text).toContain('# - aws.sqs "Fila de avisos": atributo fora das opções do contrato');
    expect(text).not.toContain('resource "aws_sqs_queue"');
  });
});
