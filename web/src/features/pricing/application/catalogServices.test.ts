// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { BLOCKS, blockDefinition, catalogServices, type BlockPricer } from '..';
import { adrExampleDesign } from '../../../test/designFixtures';
import { decimal } from '../../../shared/lib/money';
import { designDocumentSchema, type Block } from '../../../shared/lib/design';

const example = designDocumentSchema.parse(adrExampleDesign);
const [lambda, s3] = example.blocks as [Block, Block];
const block = (type: string, id: string, extra: Partial<Block> = {}): Block => ({
  ...lambda,
  attributes: {},
  ...extra,
  id,
  type,
});
/** Registro com o contrato real e a função de preço dada para todo tipo. */
const pricedBy = (pricer: BlockPricer) => ({ definition: blockDefinition, pricer: () => pricer });
const ebs: BlockPricer = () => [
  { sku: 'gp3', quantity: decimal(1), charge: 'fixed', service: 'ebs' },
  { sku: 'own', quantity: decimal(1), charge: 'fixed' },
];

describe('catalogServices', () => {
  it('devolve o serviço de cada tipo de bloco: o tipo sem `aws.`', () => {
    expect(catalogServices(example)).toEqual(['lambda', 's3']);
  });

  it('não repete o serviço de um tipo de bloco que aparece várias vezes', () => {
    expect(catalogServices({ blocks: [s3, lambda, s3, { ...s3, id: 'blk_2' }] })).toEqual([
      'lambda',
      's3',
    ]);
  });

  it('sai em ordem alfabética, qualquer que seja a ordem dos blocos', () => {
    const blocks = [block('aws.sqs', 'blk_1'), s3, block('aws.nat-gateway', 'blk_2'), lambda];
    expect(catalogServices({ blocks })).toEqual(['lambda', 'nat-gateway', 's3', 'sqs']);
    expect(catalogServices({ blocks: [...blocks].reverse() })).toEqual(catalogServices({ blocks }));
  });

  it('design sem blocos não pede serviço', () => {
    expect(catalogServices({ blocks: [] })).toEqual([]);
  });

  it('ignora o bloco de tipo fora do contrato', () => {
    const blocks = [block('aws.kinesis', 'blk_1'), block('aws.constructor', 'blk_2'), s3];
    expect(catalogServices({ blocks })).toEqual(['s3']);
  });

  it('cobre os 17 blocos com cobrança do contrato, um serviço em slug por tipo', () => {
    const blocks = BLOCKS.map(({ type }, i) => block(type, `blk_${i}`));
    const services = catalogServices({ blocks });
    expect(services).toHaveLength(17);
    // Os três de custo zero (nível C) não têm arquivo de preço.
    for (const service of ['iam', 'cloudformation', 'ecs']) expect(services).not.toContain(service);
    for (const service of services) expect(service).toMatch(/^[a-z][a-z0-9-]{0,39}$/);
  });

  it('acrescenta o serviço que uma cobrança do bloco declara', () => {
    expect(catalogServices({ blocks: [lambda] }, pricedBy(ebs))).toEqual(['ebs', 'lambda']);
  });

  it('bloco com atributo fora das opções pede só o serviço do tipo', () => {
    const invalid = block('aws.lambda', 'blk_1', { attributes: { memoryMb: 7 } });
    expect(catalogServices({ blocks: [invalid] }, pricedBy(ebs))).toEqual(['lambda']);
  });

  it('bloco de custo zero não pede serviço, nem o que a função dele declarasse', () => {
    const zeroCost = pricedBy(
      Object.assign(ebs, { zeroCost: { kind: 'no-direct-cost' } as const }),
    );
    expect(catalogServices({ blocks: [lambda] }, zeroCost)).toEqual([]);
    const blocks = [block('aws.iam', 'blk_1'), block('aws.cloudformation', 'blk_2'), s3];
    expect(catalogServices({ blocks: [...blocks, block('aws.ecs', 'blk_3')] })).toEqual(['s3']);
  });

  it('não altera o design', () => {
    const design = structuredClone(example);
    catalogServices(design);
    expect(design).toEqual(example);
  });
});
