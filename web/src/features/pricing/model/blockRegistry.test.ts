import { describe, expect, it } from 'vitest';
import { adrExampleDesign } from '../../../test/designFixtures';
import { PRD_BLOCK_LEVELS } from './blockContract';
import {
  BLOCKS,
  EDGE_KIND_DEFINITIONS,
  blockDefinition,
  blockPricer,
  edgeKindsFor,
} from './blockRegistry';

/** PRD F10. Lista escrita à mão de propósito: não deriva do código testado. */
const levelA = 'ec2 lambda rds dynamodb elasticache s3 sqs cloudfront alb cloudwatch nat-gateway'
  .split(' ')
  .map((name) => `aws.${name}`);
const vpcBlocks = ['aws.ec2', 'aws.rds', 'aws.elasticache'];

describe('contracts/blocks.json', () => {
  it('traz os 11 blocos de nível A do PRD (F10); os níveis B e C entram na continuação', () => {
    expect(BLOCKS.map((block) => block.type).sort()).toEqual([...levelA].sort());
    for (const block of BLOCKS) expect(PRD_BLOCK_LEVELS[block.type]).toBe('A');
  });

  it('só os blocos em VPC têm o atributo opcional az; os demais atributos têm padrão', () => {
    for (const block of BLOCKS) {
      const optional = block.attributes.filter((attribute) => attribute.default === undefined);
      expect(
        optional.map((attribute) => attribute.key),
        block.type,
      ).toEqual(vpcBlocks.includes(block.type) ? ['az'] : []);
    }
  });

  it('toda chave de uso tem faixa e padrão dentro dela', () => {
    for (const { usage } of [...BLOCKS, ...EDGE_KIND_DEFINITIONS]) {
      for (const key of usage) {
        expect(key.min, key.key).toBeLessThan(key.max);
        expect(key.default, key.key).toBeGreaterThanOrEqual(key.min);
        expect(key.default, key.key).toBeLessThanOrEqual(key.max);
      }
    }
  });

  it('aceita os blocos do exemplo do ADR', () => {
    for (const block of adrExampleDesign.blocks) {
      const definition = blockDefinition(block.type);
      for (const [key, value] of Object.entries(block.attributes)) {
        const options = definition?.attributes.find((attribute) => attribute.key === key)?.options;
        expect(options, `${block.type}.${key}`).toContain(value);
      }
      const used = { ...block.usage.values, ...block.overrides };
      for (const [key, value] of Object.entries(used)) {
        const range = definition?.usage.find((usage) => usage.key === key);
        expect(range, `${block.type}.${key}`).toBeDefined();
        expect(value).toBeGreaterThanOrEqual(range?.min ?? Infinity);
        expect(value).toBeLessThanOrEqual(range?.max ?? -Infinity);
      }
    }
  });

  it('todo bloco tem função de preço provisória, sem cobranças', () => {
    for (const block of BLOCKS) {
      expect(blockPricer(block.type)?.({ attributes: {}, usage: {} }), block.type).toEqual([]);
    }
  });

  it('não conhece tipo fora do contrato, nem nome herdado de Object.prototype', () => {
    for (const type of ['aws.eks', 'constructor', 'toString', '__proto__']) {
      expect(blockDefinition(type)).toBeUndefined();
      expect(blockPricer(type)).toBeUndefined();
    }
  });
});

describe('contracts/edges.json', () => {
  it('as arestas data e logs levam gbPerMonth; runs-on não tem uso', () => {
    const usage = Object.fromEntries(
      EDGE_KIND_DEFINITIONS.map((edge) => [edge.kind, edge.usage.map((key) => key.key)]),
    );
    expect(usage).toEqual({ data: ['gbPerMonth'], 'runs-on': [], logs: ['gbPerMonth'] });
  });

  it.each([
    ['aws.ecs', 'aws.ec2', []],
    ['aws.alb', 'aws.ec2', ['data']],
    ['aws.lambda', 'aws.cloudwatch', ['logs']],
    ['aws.cloudwatch', 'aws.lambda', []],
    ['aws.cloudwatch', 'aws.cloudwatch', []],
    ['aws.s3', 'aws.cloudwatch', ['logs']],
    ['aws.lambda', 'aws.eks', []],
    ['aws.eks', 'aws.s3', []],
    ['client', 'aws.cloudfront', []],
  ])('%s → %s aceita %j', (source, target, kinds) => {
    expect(edgeKindsFor(source, target)).toEqual(kinds);
  });

  it('só CloudFront, S3, ALB e EC2 têm egress para a internet (ADR-0001)', () => {
    const egress = BLOCKS.filter((block) => edgeKindsFor(block.type, 'client').length > 0);
    expect(egress.map((block) => block.type).sort()).toEqual(
      ['aws.alb', 'aws.cloudfront', 'aws.ec2', 'aws.s3'].sort(),
    );
    expect(edgeKindsFor('aws.s3', 'client')).toEqual(['data']);
  });
});
