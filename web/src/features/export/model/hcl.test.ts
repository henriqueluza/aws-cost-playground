import { describe, expect, it } from 'vitest';
import { INJECTION_PAYLOADS } from '../test/injectionPayloads';
import { HclError, commentText, formatHclNumber, hcl, quoteHclString, renderHcl } from './hcl';

/** Corpo de um literal do HCL: nenhuma aspa, `${` ou `%{` sem escape, nenhum caractere de controle. */
const SAFE_LITERAL =
  /^"(?:\\[\\"nrt]|\\u[0-9a-f]{4}|\\U[0-9a-f]{8}|\$\$\{|%%\{|\$(?!\{)|%(?!\{)|[^"\\$%\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}])*"$/u;

describe('quoteHclString', () => {
  it.each([
    ['simples', 'fila de pedidos', '"fila de pedidos"'],
    ['vazia', '', '""'],
    ['escape Unicode escrito pelo usuário', '\\u0022 \\n', '"\\\\u0022 \\\\n"'],
    ['aspas e barra', 'a"b\\c', '"a\\"b\\\\c"'],
    ['quebra de linha e tab', 'a\nb\r\tc', '"a\\nb\\r\\tc"'],
    ['interpolação', '${var.x}', '"$${var.x}"'],
    ['interpolação já escapada', '$${a}', '"$$${a}"'],
    ['diretiva', '%{ if true }', '"%%{ if true }"'],
    ['cifrão e porcentagem soltos', 'US$ 5 e 10%', '"US$ 5 e 10%"'],
    ['nulo e ESC', '\u0000\u001b', '"\\u0000\\u001b"'],
    ['bidi', '\u202e', '"\\u202e"'],
    ['formato fora do plano básico', '\u{e0001}', '"\\U000e0001"'],
    ['surrogate solto', 'a\ud800b', '"a\ufffdb"'],
    ['emoji e acento ficam como estão', 'ação 🚀', '"ação 🚀"'],
  ])('%s', (_name, input, expected) => {
    expect(quoteHclString(input)).toBe(expected);
  });

  it.each(INJECTION_PAYLOADS)(
    'carga "%s" fica presa dentro de um literal de uma linha',
    (_n, p) => {
      expect(quoteHclString(p)).toMatch(SAFE_LITERAL);
    },
  );
});

describe('formatHclNumber', () => {
  it.each([
    [0, '0'],
    [-0, '0'],
    [730, '730'],
    [1e12, '1000000000000'],
    [0.5, '0.5'],
    [1e-7, '0'],
    [-1e-9, '0'],
    [1234.5678915, '1234.567892'],
    [9007199254740991, '9007199254740991'],
  ])('%d sai como %s, sem expoente', (value, expected) => {
    expect(formatHclNumber(value)).toBe(expected);
  });

  it.each([NaN, Infinity, -Infinity, 1e21, 1e15 + 0.5])('recusa %d', (value) => {
    expect(() => formatHclNumber(value)).toThrow(HclError);
  });
});

describe('commentText', () => {
  it.each(INJECTION_PAYLOADS)('carga "%s" cabe numa linha e não fecha comentário', (_n, p) => {
    const text = commentText(p);
    expect(text).not.toMatch(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}]/u);
    expect(text).not.toContain('*/');
  });
});

describe('renderHcl', () => {
  it('escreve blocos, atributos alinhados, mapas, listas, referências e comentários', () => {
    const text = renderHcl([
      hcl.comment('Fila'),
      hcl.block(
        'resource',
        ['aws_sqs_queue', 'pedidos'],
        [
          hcl.attr('name', hcl.string('pedidos')),
          hcl.attr('fifo_queue', hcl.bool(false)),
          hcl.attr('delay_seconds', hcl.number(0)),
          hcl.attr('tags', hcl.map({ Name: hcl.string('a"b'), 'cost-center': hcl.string('x') })),
          hcl.attr(
            'depends_on',
            hcl.list([hcl.ref('aws_kms_key', 'fila'), hcl.ref('a', 'b', 0, 'id')]),
          ),
          hcl.attr('empty', hcl.map({})),
          hcl.block('lifecycle', [], []),
          hcl.comment('dentro'),
          hcl.block('timeouts', [], [hcl.attr('create', hcl.string('5m'))]),
        ],
      ),
    ]);
    expect(text).toBe(
      [
        '# Fila',
        'resource "aws_sqs_queue" "pedidos" {',
        '  name          = "pedidos"',
        '  fifo_queue    = false',
        '  delay_seconds = 0',
        '',
        '  tags = {',
        '    "Name"        = "a\\"b"',
        '    "cost-center" = "x"',
        '  }',
        '',
        '  depends_on = [aws_kms_key.fila, a.b[0].id]',
        '  empty      = {}',
        '',
        '  lifecycle {}',
        '',
        '  # dentro',
        '  timeouts {',
        '    create = "5m"',
        '  }',
        '}',
        '',
      ].join('\n'),
    );
  });

  it('isola o valor de várias linhas, alinha por símbolo e aceita identificador de 64 caracteres', () => {
    const long = 'a'.repeat(64);
    const text = renderHcl([
      hcl.block(
        'locals',
        [],
        [
          hcl.attr('x', hcl.number(1)),
          hcl.attr('rules', hcl.list([hcl.map({ port: hcl.number(443) }), hcl.map({})])),
          hcl.attr(long, hcl.map({ '🚀': hcl.bool(true), ab: hcl.bool(false) })),
        ],
      ),
    ]);
    expect(text).toBe(
      [
        'locals {',
        '  x = 1',
        '',
        '  rules = [{',
        '    "port" = 443',
        '  }, {}]',
        '',
        `  ${long} = {`,
        '    "🚀"  = true',
        '    "ab" = false',
        '  }',
        '}',
        '',
      ].join('\n'),
    );
  });

  const evil = 'x" {}\nresource "aws_iam_user" "y';
  it('escreve chamada de função da lista fechada, com cada argumento escapado', () => {
    const value = hcl.call('format', [hcl.string('%s${a}'), hcl.ref('var', 'aws_region')]);
    expect(renderHcl([hcl.attr('zona', value)])).toBe('zona = format("%s$${a}", var.aws_region)\n');
  });

  it.each([
    ['nome de atributo', () => hcl.attr(evil, hcl.bool(true))],
    ['nome de atributo com hífen', () => hcl.attr('a-b', hcl.bool(true))],
    ['tipo de bloco', () => hcl.block(evil, [], [])],
    ['rótulo de bloco', () => hcl.block('resource', ['aws_s3_bucket', evil], [])],
    ['rótulo vazio', () => hcl.block('resource', ['aws_s3_bucket', ''], [])],
    ['identificador de 65 caracteres', () => hcl.attr('a'.repeat(65), hcl.bool(true))],
    ['referência com parte vazia', () => hcl.attr('a', hcl.ref('var', '', 'x'))],
    ['referência', () => hcl.attr('a', hcl.ref('var', 'x}\nb = file("/etc/passwd")'))],
    ['referência com chamada', () => hcl.attr('a', hcl.ref('file("/etc/passwd")'))],
    ['referência vazia', () => hcl.attr('a', hcl.ref())],
    ['referência que começa por índice', () => hcl.attr('a', hcl.ref(0, 'x'))],
    ['índice negativo', () => hcl.attr('a', hcl.ref('a', -1))],
    ['índice fracionário', () => hcl.attr('a', hcl.ref('a', 1.5))],
    ['número não finito', () => hcl.attr('a', hcl.number(NaN))],
    [
      'função fora da lista',
      () => hcl.attr('a', hcl.call('file' as never, [hcl.string('/etc/passwd')])),
    ],
    ['argumento de função inválido', () => hcl.attr('a', hcl.call('format', [hcl.ref('a b')]))],
    ['valor de tipo desconhecido', () => hcl.attr('a', { kind: 'raw', value: 'x' } as never)],
    ['número dentro de lista', () => hcl.attr('a', hcl.list([hcl.number(Infinity)]))],
  ])('recusa %s em vez de escrever texto cru', (_name, node) => {
    expect(() => renderHcl([node()])).toThrow(HclError);
  });

  it.each(INJECTION_PAYLOADS)(
    'carga "%s" em valor, chave e comentário não muda a estrutura',
    (_n, p) => {
      const resource = (value: string) =>
        renderHcl([
          hcl.comment(value),
          hcl.block(
            'resource',
            ['aws_s3_bucket', 'b'],
            [
              hcl.attr('bucket', hcl.string(value)),
              hcl.attr('tags', hcl.map({ [value]: hcl.list([hcl.string(value)]) })),
            ],
          ),
        ]).split('\n');
      const lines = resource(p);
      expect(lines).toHaveLength(resource('ok').length);
      expect(lines[0]).toMatch(/^#/);
      expect(lines[1]).toBe('resource "aws_s3_bucket" "b" {');
      expect(lines[2]?.replace('  bucket = ', '')).toMatch(SAFE_LITERAL);
      const [key, item] = (lines[5] ?? '').trim().split(/ = \[(?=")/);
      expect(key).toMatch(SAFE_LITERAL);
      expect(item?.slice(0, -1)).toMatch(SAFE_LITERAL);
    },
  );
});
