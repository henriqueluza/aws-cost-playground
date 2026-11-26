import { describe, expect, it } from 'vitest';
import { BLOCKS } from '../../pricing';
import type { Block } from '../../../shared/lib/design';
import {
  buildBlockForm,
  formatUsageInput,
  parseUsageInput,
  validateLabel,
  withAttribute,
  type AttributeField,
} from './blockForm';

const blockOf = (type: string, patch: Partial<Block> = {}): Block => ({
  id: 'blk_1',
  type,
  label: '',
  attributes: {},
  usage: { source: 'default', values: {} },
  overrides: {},
  ...patch,
});

describe('buildBlockForm', () => {
  it.each(BLOCKS.map((def) => [def.type, def] as const))(
    '%s: um campo por atributo e por chave de uso, na ordem do contrato',
    (_type, def) => {
      const form = buildBlockForm(def, blockOf(def.type));
      expect(form.attributes.map((f) => f.key)).toEqual(def.attributes.map((a) => a.key));
      expect(form.usage.map((f) => f.key)).toEqual(def.usage.map((u) => u.key));
      for (const field of form.usage) {
        expect(field.origin).toBe('default');
        const key = def.usage.find((u) => u.key === field.key);
        expect(field.value).toBe(key?.default);
      }
      for (const field of form.attributes) {
        expect(field.known).toBe(true);
        expect(field.optional).toBe(field.value === undefined);
      }
    },
  );

  it('o override vence a LLM, que vence o padrão; a origem acompanha', () => {
    const def = BLOCKS.find((b) => b.type === 'aws.lambda')!;
    const block = blockOf('aws.lambda', {
      usage: { source: 'llm', values: { requestsPerMonth: 5 } },
      overrides: { requestsPerMonth: 9 },
    });
    const [requests, duration] = buildBlockForm(def, block).usage;
    expect(requests).toMatchObject({ value: 9, origin: 'manual' });
    expect(duration).toMatchObject({ value: 120, origin: 'default' });
    const llm = blockOf('aws.lambda', { usage: { source: 'llm', values: { avgDurationMs: 80 } } });
    expect(buildBlockForm(def, llm).usage[1]).toMatchObject({ value: 80, origin: 'llm' });
  });

  it('atributo fora das opções do contrato fica marcado como desconhecido', () => {
    const def = BLOCKS.find((b) => b.type === 'aws.s3')!;
    const form = buildBlockForm(
      def,
      blockOf('aws.s3', { attributes: { storageClass: 'GLACIER' } }),
    );
    expect(form.attributes[0]).toMatchObject({ value: 'GLACIER', known: false });
  });
});

describe('withAttribute', () => {
  const memory: AttributeField = {
    key: 'memoryMb',
    options: [128, 256],
    value: 128,
    optional: false,
    known: true,
  };
  const az: AttributeField = { ...memory, key: 'az', options: ['a', 'b'], optional: true };

  it('devolve a opção com o tipo do contrato (número continua número)', () => {
    expect(withAttribute({ memoryMb: 128, architecture: 'arm64' }, memory, '256')).toEqual({
      architecture: 'arm64',
      memoryMb: 256,
    });
  });
  it('recusa valor que não é opção e vazio em atributo obrigatório', () => {
    expect(withAttribute({}, memory, '999')).toBeNull();
    expect(withAttribute({}, memory, '')).toBeNull();
    expect(withAttribute({}, memory, 'constructor')).toBeNull();
  });
  it('vazio remove o atributo opcional', () => {
    expect(withAttribute({ az: 'a', x: 1 }, az, '')).toEqual({ x: 1 });
  });
});

describe('parseUsageInput', () => {
  const int = { min: 1, max: 1000, integer: true };
  const real = { min: 0, max: 744, integer: false };

  it.each([
    ['500', int, 500],
    [' 500 ', int, 500],
    ['1000', int, 1000],
    ['1', int, 1],
    ['1,5', real, 1.5],
    ['1.5', real, 1.5],
    ['0', real, 0],
    ['730,25', real, 730.25],
  ])('aceita %j', (text, field, value) => {
    expect(parseUsageInput(text, field)).toEqual({ ok: true, value });
  });

  it.each([
    ['', int, 'empty'],
    ['   ', int, 'empty'],
    ['1e9', real, 'format'],
    ['1E3', real, 'format'],
    ['-1', real, 'format'],
    ['+1', real, 'format'],
    ['abc', int, 'format'],
    ['Infinity', real, 'format'],
    ['NaN', real, 'format'],
    ['0x10', real, 'format'],
    ['1,', real, 'format'],
    ['1,2,3', real, 'format'],
    ['1.000', int, 'thousands'],
    ['1.000,5', real, 'thousands'],
    ['1,5', int, 'fraction'],
    ['0', int, 'range'],
    ['1001', int, 'range'],
    ['744,1', real, 'range'],
    ['9'.repeat(400), real, 'range'],
  ] as const)('recusa %j', (text, field, error) => {
    expect(parseUsageInput(text, field)).toEqual({ ok: false, error });
  });

  it('formatUsageInput usa vírgula e volta ao mesmo número', () => {
    expect(formatUsageInput(1.5)).toBe('1,5');
    expect(formatUsageInput(100000000000)).toBe('100000000000');
    expect(parseUsageInput(formatUsageInput(730.25), real)).toEqual({ ok: true, value: 730.25 });
  });
});

describe('validateLabel', () => {
  it('aceita texto comum, vazio e o limite de 80', () => {
    expect(validateLabel('API <b>handler</b> ção')).toBeNull();
    expect(validateLabel('')).toBeNull();
    expect(validateLabel('a'.repeat(80))).toBeNull();
  });
  it('recusa 81 caracteres e caracteres de controle', () => {
    expect(validateLabel('a'.repeat(81))).toBe('too-long');
    for (const bad of ['a\nb', 'a\tb', 'a\u0000b', 'a\u007fb', 'a\u0085b', 'a‮b', 'a b']) {
      expect(validateLabel(bad)).toBe('control');
    }
  });
});
