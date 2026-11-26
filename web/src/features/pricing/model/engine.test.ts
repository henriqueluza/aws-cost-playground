import { describe, expect, it } from 'vitest';
import { designDocumentSchema, type DesignDocument } from '../../../shared/lib/design';
import { decimal, div, mul, toFixed, type Decimal } from '../../../shared/lib/money';
import { catalogOf, type RawPrice } from '../../../test/catalogFixtures';
import { adrExampleDesign, designWithBlocks } from '../../../test/designFixtures';
import { estimate } from '..';
import type { BlockPricer } from './blockContract';
import { blockDefinition, blockPricer } from './blockRegistry';
import { createEstimator, type BlockCost, type CostEstimate } from './engine';

/** Preços públicos de us-east-1 (x86), só para a conta conferida à mão; os reais chegam na #30. */
const catalog = catalogOf({
  lambda: [
    { sku: 'requests', tiers: [[null, '0.0000002']], freeTier: { quantity: '1000000' } },
    { sku: 'duration', tiers: [[null, '0.0000166667']], freeTier: { quantity: '400000' } },
  ],
  s3: [{ sku: 'storage', tiers: [[null, '0.023']] }],
  ebs: [{ sku: 'gp3', tiers: [[null, '0.08']] }],
});

/** Funções de preço de teste: o motor é o que está sob teste, não as regras de cada bloco. */
const pricers: Record<string, BlockPricer> = {
  'aws.lambda': ({ attributes, usage }) => {
    const requests = decimal(usage.requestsPerMonth ?? 0);
    const seconds = div(mul(requests, decimal(usage.avgDurationMs ?? 0)), decimal(1000));
    const gb = div(decimal(Number(attributes.memoryMb)), decimal(1024));
    return [
      { sku: 'requests', quantity: requests, charge: 'variable' },
      { sku: 'duration', quantity: mul(seconds, gb), charge: 'variable' },
    ];
  },
  'aws.s3': ({ usage }) => [
    { sku: 'storage', quantity: decimal(usage.storageGb ?? 0), charge: 'fixed' },
    { sku: 'gp3', service: 'ebs', quantity: decimal(10), charge: 'variable' },
  ],
  'aws.sqs': () => [{ sku: 'not-in-catalog', quantity: decimal(1), charge: 'variable' }],
  'aws.iam': () => [],
};
const run = createEstimator({ definition: blockDefinition, pricer: (type) => pricers[type] });

type RawBlock = (typeof adrExampleDesign.blocks)[number];
const lambdaBlock = adrExampleDesign.blocks[0]!;
const s3Block = adrExampleDesign.blocks[1]!;
const design = (blocks: object[], region = 'us-east-1'): DesignDocument =>
  designDocumentSchema.parse({ ...adrExampleDesign, region, blocks, edges: [] });
const like = (base: RawBlock, id: string, patch: object = {}) => ({ ...base, id, ...patch });
const usd = (...values: Decimal[]) => values.map((value) => toFixed(value, 6));
const totals = (item: CostEstimate | BlockCost) => usd(item.total, item.fixed, item.variable);
const lines = (item: BlockCost) =>
  item.lines.map((l) => [l.sku, ...usd(l.quantity, l.amount), l.charge].join(' '));
const ZEROS = ['0.000000', '0.000000', '0.000000'];

describe('estimate', () => {
  it('confere à mão o exemplo do ADR: Lambda de 3 milhões de requisições, 80 ms e 512 MB', () => {
    // Requisições: 3.000.000 − 1.000.000 de franquia = 2.000.000 × US$ 0,0000002 = US$ 0,40.
    // Duração: 3.000.000 × 0,080 s × 0,5 GB = 120.000 GB-s, dentro da franquia de 400.000.
    const [lambda] = run(design([lambdaBlock]), catalog).blocks;
    expect(lines(lambda!)).toEqual([
      'requests 2000000.000000 0.400000 variable',
      'duration 0.000000 0.000000 variable',
    ]);
    expect(totals(lambda!)).toEqual(['0.400000', '0.000000', '0.400000']);
  });

  it('confere à mão a Lambda de 3 milhões de requisições, 120 ms e 2048 MB', () => {
    // Duração: 3.000.000 × 0,120 s × 2 GB = 720.000 − 400.000 = 320.000 GB-s × US$ 0,0000166667
    // = US$ 5,333344. Com US$ 0,40 de requisições: US$ 5,733344.
    const block = like(lambdaBlock, 'blk_a', { attributes: { memoryMb: 2048 }, overrides: {} });
    const result = run(
      design([{ ...block, usage: { ...block.usage, values: { requestsPerMonth: 3e6 } } }]),
      catalog,
    );
    expect(lines(result.blocks[0]!)[1]).toBe('duration 320000.000000 5.333344 variable');
    expect(toFixed(result.total, 12)).toBe('5.733344000000');
  });

  it('separa fixo de variável no bloco e no design, e resolve o serviço de cada cobrança', () => {
    // S3: 50 GB × 0,023 = 1,15 fixo (serviço do bloco) + 10 × 0,08 = 0,80 variável (serviço `ebs`).
    const result = run(design([lambdaBlock, s3Block]), catalog);
    expect(lines(result.blocks[1]!)).toEqual([
      'storage 50.000000 1.150000 fixed',
      'gp3 10.000000 0.800000 variable',
    ]);
    expect(result.blocks[1]!.lines.map((l) => toFixed(l.unitPrice, 3))).toEqual(['0.023', '0.080']);
    expect(totals(result.blocks[1]!)).toEqual(['1.950000', '1.150000', '0.800000']);
    expect(totals(result)).toEqual(['2.350000', '1.150000', '1.200000']);
  });

  it('divide a franquia entre dois blocos do mesmo tipo, na ordem do design', () => {
    const half = { ...lambdaBlock.usage, values: { requestsPerMonth: 800000, avgDurationMs: 1 } };
    const blocks = ['blk_a', 'blk_b'].map((id) =>
      like(lambdaBlock, id, { usage: half, overrides: {} }),
    );
    const result = run(design(blocks), catalog);
    expect(result.blocks.map((b) => lines(b)[0])).toEqual([
      'requests 0.000000 0.000000 variable',
      'requests 600000.000000 0.120000 variable',
    ]);
    expect(toFixed(result.total, 6)).toBe('0.120000');
  });

  it.each([
    ['SKU ausente do catálogo', like(lambdaBlock, 'blk_x', { type: 'aws.sqs', attributes: {} })],
    ['serviço não carregado', like(lambdaBlock, 'blk_x', { type: 'aws.sqs', attributes: {} })],
    ['tipo de bloco fora do contrato', like(lambdaBlock, 'blk_x', { type: 'aws.unknown' })],
    [
      'tipo do contrato sem função de preço',
      like(lambdaBlock, 'blk_x', { type: 'aws.ec2', attributes: {} }),
    ],
    ['atributo fora das opções', like(lambdaBlock, 'blk_x', { attributes: { memoryMb: 1536 } })],
  ])('marca como indisponível, zerado e fora dos totais: %s', (name, bad) => {
    const services: Record<string, RawPrice[]> = name.startsWith('serviço')
      ? {}
      : { sqs: [{ sku: 'other' }] };
    const priced = catalogOf({ lambda: [{ sku: 'requests' }, { sku: 'duration' }], ...services });
    const result = run(design([bad, lambdaBlock]), priced);
    const [unavailable, lambda] = result.blocks;
    expect(unavailable).toMatchObject({ status: 'unavailable', lines: [], blockId: 'blk_x' });
    expect(totals(unavailable!)).toEqual(ZEROS);
    expect(lambda?.status).toBe('priced');
    expect(totals(result)).toEqual(totals(lambda!));
  });

  it('marca todo bloco como indisponível se o catálogo é de outra região', () => {
    const result = run(
      design(
        [lambdaBlock, like(lambdaBlock, 'blk_c', { type: 'aws.iam', attributes: {} })],
        'sa-east-1',
      ),
      catalog,
    );
    expect(result.blocks.map((b) => b.status)).toEqual(['unavailable', 'unavailable']);
    expect(totals(result)).toEqual(ZEROS);
  });

  it('bloco sem cobranças (nível C) tem preço zero, sem linhas', () => {
    const iam = like(lambdaBlock, 'blk_c', { type: 'aws.iam', attributes: {} });
    const [block] = run(design([iam]), catalog).blocks;
    expect(block).toMatchObject({ status: 'priced', lines: [], blockType: 'aws.iam' });
  });

  it('preserva a ordem do design; as arestas saem com preço zero até a #42', () => {
    const kinds = ['logs', 'data', 'runs-on'] as const;
    const ordered = designDocumentSchema.parse({
      ...adrExampleDesign,
      blocks: designWithBlocks(4).blocks.reverse(),
      edges: kinds.map((kind, i) => ({
        ...adrExampleDesign.edges[0],
        ...{ id: `edg_${i}`, source: `blk_${i}`, target: `blk_${i + 1}`, kind },
      })),
    });
    const { blocks, edges } = run(ordered, catalog);
    expect(blocks.map((b) => b.blockId)).toEqual(['blk_3', 'blk_2', 'blk_1', 'blk_0']);
    expect(edges.map((e) => [e.edgeId, e.kind])).toEqual(
      kinds.map((kind, i) => [`edg_${i}`, kind]),
    );
    edges.forEach((edge) => expect(edge).toMatchObject({ status: 'priced', lines: [] }));
  });

  it('é determinística e pura: repete o resultado e não altera design nem catálogo', () => {
    const deepFreeze = <T>(value: T): T => {
      if (typeof value === 'object' && value !== null) Object.values(value).forEach(deepFreeze);
      return Object.freeze(value);
    };
    const input = deepFreeze(design([lambdaBlock, s3Block, like(lambdaBlock, 'blk_b')]));
    const before = structuredClone(catalog);
    const first = run(input, catalog);
    expect(run(input, catalog)).toEqual(first);
    expect(run(structuredClone(input), structuredClone(catalog))).toEqual(first);
    expect(catalog).toEqual(before);
  });

  it('com o registro real e o exemplo do ADR, os blocos saem com preço e a Lambda com as cobranças dela', () => {
    // Lambda arm64: (3.000.000 − 1.000.000) × US$ 0,0000002 = US$ 0,40; 3.000.000 × 0,080 s ×
    // 0,5 GB = 120.000 GB-s, dentro da franquia de 400.000. O S3 ainda é provisório, sem cobranças.
    const arm64 = catalogOf({
      lambda: [
        {
          sku: 'lambda-requests-arm64',
          tiers: [[null, '0.0000002']],
          freeTier: { quantity: '1000000' },
        },
        {
          sku: 'lambda-duration-arm64',
          tiers: [[null, '0.0000133334']],
          freeTier: { quantity: '400000' },
        },
      ],
    });
    const result = estimate(designDocumentSchema.parse(adrExampleDesign), arm64);
    expect(result.blocks.map((b) => [b.blockId, b.blockType, b.status, b.lines.length])).toEqual([
      ['blk_fn_api', 'aws.lambda', 'priced', 2],
      ['blk_assets', 'aws.s3', 'priced', 0],
    ]);
    expect(lines(result.blocks[0]!)).toEqual([
      'lambda-requests-arm64 2000000.000000 0.400000 variable',
      'lambda-duration-arm64 0.000000 0.000000 variable',
    ]);
    expect(totals(result)).toEqual(['0.400000', '0.000000', '0.400000']);
    expect(blockPricer('aws.lambda')).toBeDefined();
  });
});
