import { describe, expect, it } from 'vitest';
import { adrExampleDesign } from '../../../test/designFixtures';
import { BLOCK_TYPES, PRD_BLOCK_LEVELS } from './blockContract';
import {
  BLOCKS,
  EDGE_KIND_DEFINITIONS,
  blockDefinition,
  blockPricer,
  edgeKindsFor,
} from './blockRegistry';

/** PRD F2, na ordem do texto. Lista escrita à mão de propósito: não deriva do código testado. */
const prdBlocks =
  'route53 cloudfront waf alb ec2 ecs lambda elasticache rds dynamodb s3 sqs cognito iam secrets-manager cloudwatch cloudtrail codepipeline cloudformation nat-gateway'
    .split(' ')
    .map((name) => `aws.${name}`);
const vpcBlocks = ['aws.ec2', 'aws.ecs', 'aws.rds', 'aws.elasticache'];

/**
 * Cópia das tabelas da #176, na ordem: `tipo; nome; categoria; atributo=opções:padrão; chave[unidade]padrão/mín/máx/tipo`.
 * Mudar `contracts/blocks.json` exige mudar aqui: o contrato é lido pelo motor, pelo editor e pela API.
 */
const levelATables = [
  'aws.lambda; Lambda; compute; architecture=x86_64|arm64:arm64 memoryMb=128|256|512|1024|2048|4096|8192|10240:512; requestsPerMonth[requests]1000000/0/100000000000/int avgDurationMs[ms]120/1/900000/int',
  'aws.s3; S3; storage; storageClass=STANDARD|STANDARD_IA:STANDARD; storageGb[GB]50/0/10000000/dec putRequestsPerMonth[requests]100000/0/100000000000/int getRequestsPerMonth[requests]1000000/0/100000000000/int',
  'aws.sqs; SQS; integration; queueType=standard|fifo:standard; requestsPerMonth[requests]1000000/0/100000000000/int',
  'aws.dynamodb; DynamoDB; database; capacityMode=on-demand|provisioned:on-demand; readRequestsPerMonth[requests]1000000/0/100000000000/int writeRequestsPerMonth[requests]500000/0/100000000000/int storageGb[GB]5/0/1000000/dec provisionedReadUnits[RCU]5/0/100000/int provisionedWriteUnits[WCU]5/0/100000/int',
  'aws.ec2; EC2; compute; instanceType=t3.micro|t3.small|t3.medium|t3.large|t4g.micro|t4g.small|t4g.medium|m5.large|m5.xlarge|c5.large|r5.large:t3.small az=a|b|c:; instanceCount[instances]1/1/1000/int hoursPerMonth[hours]730/0/744/dec rootVolumeGb[GB]30/8/16384/int',
  'aws.rds; RDS; database; engine=postgres|mysql:postgres instanceClass=db.t3.micro|db.t3.small|db.t3.medium|db.t4g.micro|db.t4g.small|db.t4g.medium|db.m5.large|db.r5.large:db.t3.micro deployment=single-az|multi-az:single-az az=a|b|c:; storageGb[GB]20/20/65536/int backupStorageGb[GB]20/0/1000000/dec',
  'aws.elasticache; ElastiCache; database; engine=redis|memcached:redis nodeType=cache.t3.micro|cache.t3.small|cache.t3.medium|cache.t4g.micro|cache.t4g.small|cache.t4g.medium|cache.m5.large|cache.r5.large:cache.t3.micro az=a|b|c:; nodeCount[nodes]1/1/500/int',
  'aws.cloudfront; CloudFront; networking; ; requestsPerMonth[requests]1000000/0/100000000000/int',
  'aws.alb; ALB; networking; ; newConnectionsPerSecond[connections/s]10/0/1000000/dec activeConnectionsPerMinute[connections/min]1000/0/100000000/dec processedGbPerMonth[GB]100/0/100000000/dec ruleEvaluationsPerSecond[evaluations/s]0/0/10000000/dec',
  'aws.cloudwatch; CloudWatch; management; ; logsIngestedGbPerMonth[GB]5/0/10000000/dec logsStoredGb[GB]5/0/100000000/dec customMetrics[metrics]10/0/1000000/int alarms[alarms]10/0/100000/int',
  'aws.nat-gateway; NAT Gateway; networking; ; processedGbPerMonth[GB]100/0/100000000/dec',
];
const signature = (block: (typeof BLOCKS)[number]) =>
  [
    block.type,
    block.name,
    block.category,
    block.attributes.map((a) => `${a.key}=${a.options.join('|')}:${a.default ?? ''}`).join(' '),
    block.usage
      .map((u) => `${u.key}[${u.unit}]${u.default}/${u.min}/${u.max}/${u.integer ? 'int' : 'dec'}`)
      .join(' '),
  ].join('; ');

describe('contracts/blocks.json', () => {
  it('traz os 20 blocos do PRD, sem faltar nem sobrar', () => {
    expect(BLOCKS.map((block) => block.type).sort()).toEqual([...prdBlocks].sort());
    expect([...BLOCK_TYPES].sort()).toEqual([...prdBlocks].sort());
  });

  it('segue os níveis do PRD: 11 blocos A, 6 B e 3 C de custo zero', () => {
    const count = (level: string) => BLOCKS.filter((block) => block.level === level).length;
    expect([count('A'), count('B'), count('C')]).toEqual([11, 6, 3]);
    expect(PRD_BLOCK_LEVELS['aws.ecs']).toBe('C');
  });

  it('cada bloco tem os atributos, opções, padrões, unidades e faixas da tabela da #176', () => {
    expect(BLOCKS.map(signature)).toEqual(levelATables);
  });

  it('a mesma chave de uso tem a mesma unidade em todos os blocos', () => {
    const units = new Map<string, string>();
    for (const key of BLOCKS.flatMap((block) => block.usage)) {
      expect(units.get(key.key) ?? key.unit, key.key).toBe(key.unit);
      units.set(key.key, key.unit);
    }
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
    ['aws.ecs', 'aws.ec2', ['data', 'runs-on']],
    ['aws.ec2', 'aws.ecs', ['data']],
    ['aws.alb', 'aws.ec2', ['data']],
    ['aws.lambda', 'aws.cloudwatch', ['logs']],
    ['aws.cloudwatch', 'aws.lambda', []],
    ['aws.cloudwatch', 'aws.cloudwatch', []],
    ['aws.iam', 'aws.s3', []],
    ['aws.iam', 'aws.cloudwatch', ['logs']],
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

  it('runs-on só existe de ECS para EC2', () => {
    const pairs = BLOCKS.flatMap((source) =>
      BLOCKS.filter((target) => edgeKindsFor(source.type, target.type).includes('runs-on')).map(
        (target) => [source.type, target.type],
      ),
    );
    expect(pairs).toEqual([['aws.ecs', 'aws.ec2']]);
  });
});
