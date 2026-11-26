import { describe, expect, it } from 'vitest';
import edgesJson from '../../../../../contracts/edges.json';
import { blocksFileSchema, edgesFileSchema } from './blockContract';

const requests = { key: 'requestsPerMonth', unit: 'requests', default: 10, min: 0, max: 100 };
const lambda = {
  type: 'aws.lambda',
  name: 'Lambda',
  category: 'compute',
  level: 'A',
  attributes: [{ key: 'architecture', options: ['x86_64', 'arm64'], default: 'arm64' }],
  usage: [{ ...requests, integer: true }],
};
const blocksFile = (block: object) => ({ schemaVersion: 1, blocks: [block] });
const withUsage = (usage: object) => blocksFile({ ...lambda, usage: [usage] });
const withAttribute = (attribute: object) => blocksFile({ ...lambda, attributes: [attribute] });

const gb = { key: 'gbPerMonth', unit: 'GB', default: 10, min: 0, max: 100, integer: false };
const pair = (sources: string[], targets: string[]) => ({ sources, targets });
const edgeKinds = [
  { kind: 'data', usage: [gb], pairs: [pair(['aws.s3'], ['client', 'aws.lambda'])] },
  { kind: 'runs-on', usage: [], pairs: [pair(['aws.ecs'], ['aws.ec2'])] },
  { kind: 'logs', usage: [gb], pairs: [pair(['aws.lambda'], ['aws.cloudwatch'])] },
];
const edgesFile = (kinds: object[]) => ({ schemaVersion: 1, kinds });

describe('blocksFileSchema', () => {
  it('aceita uma definição completa e descarta chave desconhecida', () => {
    const parsed = blocksFileSchema.parse(blocksFile({ ...lambda, icon: 'x' }));
    expect(parsed.blocks).toEqual([lambda]);
  });

  it('aceita atributo opcional, sem padrão', () => {
    const file = withAttribute({ key: 'az', options: ['a', 'b', 'c'] });
    expect(blocksFileSchema.safeParse(file).success).toBe(true);
  });

  it.each([
    ['sem faixa (falta max)', { ...requests, integer: true, max: undefined }],
    ['sem faixa (falta min)', { ...requests, integer: true, min: undefined }],
    ['sem unidade', { ...requests, integer: true, unit: '' }],
    ['sem dizer se é inteira', requests],
    ['com padrão acima da faixa', { ...requests, integer: true, default: 101 }],
    ['com padrão abaixo da faixa', { ...requests, integer: true, min: 20 }],
    ['com faixa vazia', { ...requests, integer: true, default: 5, min: 5, max: 5 }],
    ['inteira com padrão fracionário', { ...requests, integer: true, default: 1.5 }],
    ['com mínimo negativo', { ...requests, integer: true, min: -1 }],
    ['com máximo acima do limite do design', { ...requests, integer: true, max: 1e13 }],
    ['com máximo infinito', { ...requests, integer: true, max: Infinity }],
    ['com nome de Object.prototype', { ...requests, integer: true, key: 'constructor' }],
  ])('recusa chave de uso %s', (_case, usage) => {
    expect(blocksFileSchema.safeParse(withUsage(usage)).success).toBe(false);
  });

  it.each([
    ['com padrão fora das opções', { key: 'architecture', options: ['arm64'], default: 'mips' }],
    ['sem opções', { key: 'architecture', options: [] }],
    ['com opção repetida', { key: 'architecture', options: ['arm64', 'arm64'] }],
    ['com opção booleana', { key: 'architecture', options: [true] }],
  ])('recusa atributo %s', (_case, attribute) => {
    expect(blocksFileSchema.safeParse(withAttribute(attribute)).success).toBe(false);
  });

  it.each([
    ['tipo fora do PRD', blocksFile({ ...lambda, type: 'aws.eks' })],
    ['nível diferente do PRD', blocksFile({ ...lambda, level: 'B' })],
    ['categoria desconhecida', blocksFile({ ...lambda, category: 'serverless' })],
    ['chave de uso repetida', blocksFile({ ...lambda, usage: [lambda.usage[0], lambda.usage[0]] })],
    ['tipo de bloco repetido', { schemaVersion: 1, blocks: [lambda, lambda] }],
    ['versão desconhecida', { schemaVersion: 2, blocks: [lambda] }],
  ])('recusa %s', (_case, file) => {
    expect(blocksFileSchema.safeParse(file).success).toBe(false);
  });
});

describe('edgesFileSchema', () => {
  it('aceita os três tipos de aresta com pares e uso', () => {
    expect(edgesFileSchema.parse(edgesFile(edgeKinds)).kinds).toEqual(edgeKinds);
  });

  it.each([
    ['tipo de aresta faltando', edgeKinds.slice(0, 2)],
    ['tipo de aresta repetido', [edgeKinds[0], edgeKinds[0], edgeKinds[1]]],
    ['tipo de aresta desconhecido', [...edgeKinds.slice(0, 2), { ...edgeKinds[2], kind: 'x' }]],
    ['par sem origem', [{ ...edgeKinds[0], pairs: [pair([], ['client'])] }, ...edgeKinds.slice(1)]],
    [
      'origem client',
      [{ ...edgeKinds[0], pairs: [pair(['client'], ['aws.s3'])] }, ...edgeKinds.slice(1)],
    ],
    [
      'bloco fora do PRD',
      [{ ...edgeKinds[0], pairs: [pair(['aws.eks'], ['aws.s3'])] }, ...edgeKinds.slice(1)],
    ],
    [
      'logs para a internet',
      [...edgeKinds.slice(0, 2), { ...edgeKinds[2], pairs: [pair(['aws.s3'], ['client'])] }],
    ],
    [
      'uso sem faixa',
      [{ ...edgeKinds[0], usage: [{ ...gb, max: undefined }] }, ...edgeKinds.slice(1)],
    ],
  ])('recusa %s', (_case, kinds) => {
    expect(edgesFileSchema.safeParse(edgesFile(kinds as object[])).success).toBe(false);
  });

  it('contracts/edges.json segue o schema, com runs-on só de ECS para EC2', () => {
    const { kinds } = edgesFileSchema.parse(edgesJson);
    const runsOn = kinds.find((edge) => edge.kind === 'runs-on');
    expect(runsOn?.pairs).toEqual([{ sources: ['aws.ecs'], targets: ['aws.ec2'] }]);
  });

  it('contracts/edges.json só leva à internet a partir de CloudFront, S3, ALB e EC2 (ADR-0001)', () => {
    const { kinds } = edgesFileSchema.parse(edgesJson);
    const toClient = kinds.flatMap((edge) =>
      edge.pairs.filter((p) => p.targets.includes('client')),
    );
    expect(toClient).toEqual([
      { sources: ['aws.cloudfront', 'aws.s3', 'aws.alb', 'aws.ec2'], targets: ['client'] },
    ]);
  });
});
