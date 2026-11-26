import { describe, expect, it } from 'vitest';
import { INJECTION_PAYLOADS } from '../test/injectionPayloads';
import { MAX_NAME_LENGTH, terraformName, uniqueNames } from './names';

const VALID_NAME = /^[a-z][a-z0-9_]{0,47}$/;

describe('terraformName', () => {
  it.each([
    ['API handler', 'api_handler'],
    ['Fila de Pedidos (v2)', 'fila_de_pedidos_v2'],
    ['ação São João', 'acao_sao_joao'],
    ['__x__', 'x'],
    ['3 filas', 'r_3_filas'],
    ['', 'lambda'],
    ['🚀🚀', 'lambda'],
    ['"}\nresource "aws_iam_user" "x" {', 'resource_aws_iam_user_x'],
    ['${file("/etc/passwd")}', 'file_etc_passwd'],
  ])('%j vira %s', (label, expected) => {
    expect(terraformName(label, 'lambda')).toBe(expected);
  });

  it.each(INJECTION_PAYLOADS)('carga "%s" dá um identificador válido', (_name, payload) => {
    expect(terraformName(payload, 's3')).toMatch(VALID_NAME);
  });

  it('corta no tamanho máximo sem terminar em sublinhado', () => {
    const name = terraformName(`${'a'.repeat(MAX_NAME_LENGTH - 1)} b`, 's3');
    expect(name).toBe('a'.repeat(MAX_NAME_LENGTH - 1));
  });

  it('usa um nome fixo quando nem o texto nem o fallback servem', () => {
    expect(terraformName('!!!', '???')).toBe('bloco');
    expect(terraformName('', '9')).toBe('r_9');
  });
});

describe('uniqueNames', () => {
  const item = (id: string, text: string) => ({ id, text, fallback: 's3' });

  it('resolve colisões com sufixo estável, na ordem recebida', () => {
    const names = uniqueNames([
      item('a', 'Fila'),
      item('b', 'fila!'),
      item('c', 'FILA'),
      item('d', 'fila 2'),
      item('e', ''),
      item('f', ''),
    ]);
    expect([...names]).toEqual([
      ['a', 'fila'],
      ['b', 'fila_2'],
      ['c', 'fila_3'],
      ['d', 'fila_2_2'],
      ['e', 's3'],
      ['f', 's3_2'],
    ]);
  });

  it('mantém o tamanho máximo e a unicidade com 100 rótulos longos iguais', () => {
    const long = 'x'.repeat(80);
    const names = [
      ...uniqueNames(Array.from({ length: 100 }, (_, i) => item(`i${i}`, long))).values(),
    ];
    expect(new Set(names).size).toBe(100);
    for (const name of names) expect(name).toMatch(VALID_NAME);
    expect(names[99]).toBe(`${'x'.repeat(MAX_NAME_LENGTH - 4)}_100`);
  });
});
