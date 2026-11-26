import { describe, expect, it } from 'vitest';
import { buildExportModel } from '../exportBlocks';
import { hcl, renderHcl } from '../hcl';
import { design } from '../../test/generatorHarness';
import { dataPeers } from './links';
import { denyInsecureTransport, policyDocument, policyJson } from './policyDocument';

describe('policyDocument', () => {
  const arn = hcl.ref('aws_sqs_queue', 'fila', 'arn');

  it('escreve a política como data source, com principal e condição em blocos', () => {
    const document = policyDocument('fila', [
      denyInsecureTransport('sqs:*', [arn]),
      { actions: ['sts:AssumeRole'], principal: { type: 'Service', identifiers: ['x.aws'] } },
    ]);
    expect(renderHcl([document])).toBe(
      [
        'data "aws_iam_policy_document" "fila" {',
        '  statement {',
        '    effect    = "Deny"',
        '    actions   = ["sqs:*"]',
        '    resources = [aws_sqs_queue.fila.arn]',
        '',
        '    principals {',
        '      type        = "*"',
        '      identifiers = ["*"]',
        '    }',
        '',
        '    condition {',
        '      test     = "Bool"',
        '      variable = "aws:SecureTransport"',
        '      values   = ["false"]',
        '    }',
        '  }',
        '',
        '  statement {',
        '    effect  = "Allow"',
        '    actions = ["sts:AssumeRole"]',
        '',
        '    principals {',
        '      type        = "Service"',
        '      identifiers = ["x.aws"]',
        '    }',
        '  }',
        '}',
        '',
      ].join('\n'),
    );
    expect(policyJson('fila')).toEqual(hcl.ref('data', 'aws_iam_policy_document', 'fila', 'json'));
  });

  it('texto hostil numa ação fica preso no literal', () => {
    const text = renderHcl([policyDocument('p', [{ actions: ['"]\n}\nresource "x" "y" {'] }])]);
    expect(text.split('\n')).toHaveLength(7);
    expect(text).toContain('actions = ["\\"]\\n}\\nresource \\"x\\" \\"y\\" {"]');
  });
});

describe('dataPeers', () => {
  const model = buildExportModel(
    design(
      [
        { id: 'fn', type: 'aws.lambda' },
        { id: 'q', type: 'aws.sqs' },
        { id: 'q2', type: 'aws.sqs' },
        { id: 'logs', type: 'aws.cloudwatch' },
      ],
      [
        ['q', 'fn'],
        ['q', 'fn'],
        ['fn', 'q2'],
        ['fn', 'logs', 'logs'],
        ['fn', 'client'],
      ],
    ),
  );
  const links = model.links.get('blk_fn') ?? [];
  const ids = (role: 'source' | 'target', type: 'aws.sqs' | 'aws.cloudwatch' | 'aws.s3') =>
    dataPeers(links, role, type).map((peer) => peer.id);

  it('devolve os pares do tipo pelo papel deste bloco, sem repetir a aresta duplicada', () => {
    expect(ids('target', 'aws.sqs')).toEqual(['blk_q']);
    expect(ids('source', 'aws.sqs')).toEqual(['blk_q2']);
  });

  it('ignora aresta de logs, a internet e tipo sem ligação', () => {
    expect(ids('source', 'aws.cloudwatch')).toEqual([]);
    expect(ids('source', 'aws.s3')).toEqual([]);
  });
});
