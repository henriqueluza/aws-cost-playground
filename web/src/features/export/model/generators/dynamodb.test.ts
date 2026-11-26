import { describe, expect, it } from 'vitest';
import {
  body,
  bodies,
  design,
  generate,
  mainTf,
  plain,
  resourceTypes,
  value,
} from '../../test/generatorHarness';

const table = { id: 't', type: 'aws.dynamodb', label: 'Resultados' };
const provisioned = (usage: Record<string, number>) =>
  body(
    generate([{ ...table, attributes: { capacityMode: 'provisioned' }, usage }]),
    'resource',
    'aws_dynamodb_table',
    'resultados',
  );

describe('gerador do DynamoDB', () => {
  const nodes = generate([table]);
  const main = body(nodes, 'resource', 'aws_dynamodb_table', 'resultados');

  it('tabela on-demand com criptografia, recuperação pontual e proteção contra exclusão', () => {
    expect(resourceTypes(nodes)).toEqual(['aws_dynamodb_table']);
    expect(plain(value(main, 'billing_mode'))).toBe('PAY_PER_REQUEST');
    expect(value(main, 'read_capacity')).toBeUndefined();
    expect(value(main, 'write_capacity')).toBeUndefined();
    expect(plain(value(main, 'deletion_protection_enabled'))).toBe(true);
    expect(plain(value(body(main, 'server_side_encryption'), 'enabled'))).toBe(true);
    expect(plain(value(body(main, 'point_in_time_recovery'), 'enabled'))).toBe(true);
  });

  it('o esquema de chaves é o mínimo de exemplo, avisado em comentário', () => {
    expect(plain(value(main, 'hash_key'))).toBe('pk');
    expect(plain(value(main, 'range_key'))).toBe('sk');
    expect(
      bodies(main, 'attribute').map((a) => [plain(value(a, 'name')), plain(value(a, 'type'))]),
    ).toEqual([
      ['pk', 'S'],
      ['sk', 'S'],
    ]);
    expect(nodes[0]).toMatchObject({ kind: 'comment', text: expect.stringContaining('exemplo') });
  });

  it('modo provisionado usa as capacidades do uso, com o mínimo de 1 que a AWS exige', () => {
    const sized = provisioned({ provisionedReadUnits: 20, provisionedWriteUnits: 50 });
    expect(plain(value(sized, 'billing_mode'))).toBe('PROVISIONED');
    expect(plain(value(sized, 'read_capacity'))).toBe(20);
    expect(plain(value(sized, 'write_capacity'))).toBe(50);
    const empty = provisioned({ provisionedReadUnits: 0, provisionedWriteUnits: 0 });
    expect(plain(value(empty, 'read_capacity'))).toBe(1);
    expect(plain(value(empty, 'write_capacity'))).toBe(1);
  });

  it('atributo fora do contrato recusa o bloco', () => {
    const text = mainTf(design([{ ...table, attributes: { capacityMode: 'serverless' } }]));
    expect(text).toContain('# - aws.dynamodb "Resultados": atributo fora das opções do contrato');
    expect(text).not.toContain('resource "aws_dynamodb_table"');
  });
});
