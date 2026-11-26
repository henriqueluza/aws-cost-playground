import { describe, expect, it } from 'vitest';
import { blockSchema, type Block } from '../../../shared/lib/design';
import { adrExampleDesign } from '../../../test/designFixtures';
import { blockPriceInput } from './blockInput';
import { blockDefinition } from './blockRegistry';

const lambda = blockDefinition('aws.lambda')!;
const ec2 = blockDefinition('aws.ec2')!;
const block = (type: string, patch: Partial<Block>): Block =>
  blockSchema.parse({
    ...adrExampleDesign.blocks[0],
    type,
    attributes: {},
    overrides: {},
    ...patch,
  });
const usage = (values: Record<string, number>) => ({ source: 'llm' as const, values });

describe('blockPriceInput', () => {
  it('entrega o uso efetivo: o override vence o valor estimado', () => {
    const input = blockPriceInput(lambda, blockSchema.parse(adrExampleDesign.blocks[0]));
    expect(input).toEqual({
      attributes: { memoryMb: 512, architecture: 'arm64' },
      usage: { requestsPerMonth: 3000000, avgDurationMs: 80 },
    });
  });

  it('completa atributo e chave de uso ausentes com o padrão do contrato', () => {
    expect(blockPriceInput(lambda, block('aws.lambda', { usage: usage({}) }))).toEqual({
      attributes: { architecture: 'arm64', memoryMb: 512 },
      usage: { requestsPerMonth: 1000000, avgDurationMs: 120 },
    });
  });

  it('deixa de fora o atributo opcional ausente e aceita o informado', () => {
    expect(blockPriceInput(ec2, block('aws.ec2', {}))?.attributes).toEqual({
      instanceType: 't3.small',
    });
    const input = blockPriceInput(ec2, block('aws.ec2', { attributes: { az: 'b' } }));
    expect(input?.attributes).toEqual({ instanceType: 't3.small', az: 'b' });
  });

  it.each([
    ['abaixo do mínimo', { avgDurationMs: 0 }, { avgDurationMs: 1 }],
    ['acima do máximo', { requestsPerMonth: 1e12 }, { requestsPerMonth: 1e11 }],
    ['no limite', { avgDurationMs: 900000 }, { avgDurationMs: 900000 }],
    ['fração em chave inteira sobe', { avgDurationMs: 80.2 }, { avgDurationMs: 81 }],
  ])('limita o uso à faixa do contrato: %s', (_, values, expected) => {
    const input = blockPriceInput(lambda, block('aws.lambda', { usage: usage(values) }));
    expect(input?.usage).toMatchObject(expected);
  });

  it('mantém fração em chave decimal e limita o override como o valor estimado', () => {
    const input = blockPriceInput(
      ec2,
      block('aws.ec2', { usage: usage({ hoursPerMonth: 100.5 }), overrides: { instanceCount: 0 } }),
    );
    expect(input?.usage).toEqual({ instanceCount: 1, hoursPerMonth: 100.5, rootVolumeGb: 30 });
  });

  it('descarta chave de uso e atributo que o contrato não tem', () => {
    const input = blockPriceInput(
      lambda,
      block('aws.lambda', { attributes: { color: 'red' }, usage: usage({ storageGb: 9 }) }),
    );
    expect(Object.keys(input?.attributes ?? {})).toEqual(['architecture', 'memoryMb']);
    expect(Object.keys(input?.usage ?? {})).toEqual(['requestsPerMonth', 'avgDurationMs']);
  });

  it.each([
    ['valor fora das opções', { memoryMb: 1536 }],
    ['tipo diferente das opções', { memoryMb: '512' }],
    ['booleano', { architecture: true }],
  ])('recusa atributo com %s', (_, attributes) => {
    expect(blockPriceInput(lambda, block('aws.lambda', { attributes }))).toBeUndefined();
  });
});
