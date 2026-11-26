// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  BLOCKS,
  EDGE_KIND_DEFINITIONS,
  blockPricer,
  catalogServices,
  estimate,
  type CostEstimate,
} from '..';
import { designDocumentSchema, type DesignDocument } from '../../../shared/lib/design';
import { toFixed } from '../../../shared/lib/money';
import { catalogOf } from '../../../test/catalogFixtures';
import { adrExampleDesign } from '../../../test/designFixtures';
import { zeroCostPricer, zeroCostReport, zeroCostRule } from './zeroCost';

const lambda = adrExampleDesign.blocks[0]!;
const block = (id: string, type: string, attributes: object = {}) => ({
  id,
  type,
  label: id,
  attributes,
  usage: { source: 'default', values: {} },
  overrides: {},
});
const edge = (id: string, source: string, target: string, kind = 'runs-on') => ({
  id,
  source,
  target,
  kind,
  usage: { source: 'default', values: {} },
  overrides: {},
});
const design = (blocks: object[], edges: object[] = [], region = 'us-east-1'): DesignDocument =>
  designDocumentSchema.parse({ ...adrExampleDesign, region, blocks, edges });

/** Sem nenhum serviço carregado: o que o motor recebe antes de o catálogo chegar. */
const emptyCatalog = catalogOf({});
/** Preços públicos de us-east-1 da Lambda arm64, para o bloco pago dos testes mistos. */
const loadedCatalog = catalogOf({
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
const catalogs = [
  ['sem catálogo carregado', emptyCatalog],
  ['com catálogo carregado', loadedCatalog],
] as const;
const totals = (item: Pick<CostEstimate, 'total' | 'fixed' | 'variable'>) =>
  [item.total, item.fixed, item.variable].map((value) => toFixed(value, 6));
const ZEROS = ['0.000000', '0.000000', '0.000000'];
const ecs = block('blk_ecs', 'aws.ecs');
const ec2 = block('blk_ec2', 'aws.ec2');

describe('blocos de custo zero (IAM, CloudFormation, ECS)', () => {
  it('são exatamente os de nível C do contrato, e a função de preço deles nunca cobra', () => {
    const zeroCost = BLOCKS.filter(({ type }) => zeroCostRule(blockPricer(type)) !== undefined);
    expect(zeroCost.map(({ type }) => type).sort()).toEqual(
      BLOCKS.filter(({ level }) => level === 'C')
        .map(({ type }) => type)
        .sort(),
    );
    expect(zeroCost.map(({ type }) => type).sort()).toEqual([
      'aws.cloudformation',
      'aws.ecs',
      'aws.iam',
    ]);
    for (const { type } of zeroCost) {
      expect(blockPricer(type)?.({ attributes: { az: 'a' }, usage: { any: 1e9 } })).toEqual([]);
    }
  });

  it('os hosts do ECS são os destinos da aresta `runs-on` em contracts/edges.json', () => {
    const runsOn = EDGE_KIND_DEFINITIONS.find(({ kind }) => kind === 'runs-on');
    const targets = runsOn?.pairs
      .filter((p) => p.sources.includes('aws.ecs'))
      .flatMap((p) => p.targets);
    expect(zeroCostRule(blockPricer('aws.ecs'))).toEqual({
      kind: 'billed-on-host',
      hostTypes: targets,
    });
    expect(targets).toEqual(['aws.ec2']);
  });

  describe.each(catalogs)('%s', (_name, catalog) => {
    it.each(['aws.iam', 'aws.cloudformation'])(
      '%s sai `priced` com zero e sem custo direto',
      (type) => {
        const result = estimate(design([block('blk_c', type)]), catalog);
        expect(result.blocks).toHaveLength(1);
        expect(result.blocks[0]).toMatchObject({
          status: 'priced',
          blockId: 'blk_c',
          blockType: type,
          lines: [],
          note: { kind: 'no-direct-cost' },
        });
        expect(totals(result.blocks[0]!)).toEqual(ZEROS);
        expect(totals(result)).toEqual(ZEROS);
        expect(result.warnings).toEqual([]);
      },
    );

    it.each([
      ['sem `az`', {}],
      ['com `az`', { az: 'b' }],
    ])('ECS %s sai `priced` com zero e aponta o EC2 da aresta `runs-on`', (_case, attributes) => {
      const result = estimate(
        design(
          [block('blk_ecs', 'aws.ecs', attributes), ec2],
          [edge('edg_1', 'blk_ecs', 'blk_ec2')],
        ),
        catalog,
      );
      expect(result.blocks[0]).toMatchObject({
        status: 'priced',
        blockType: 'aws.ecs',
        lines: [],
        note: { kind: 'billed-on-host', hostBlockIds: ['blk_ec2'] },
      });
      expect(totals(result.blocks[0]!)).toEqual(ZEROS);
      expect(result.warnings).toEqual([]);
    });

    it('ECS sem aresta `runs-on` gera aviso, não erro, e continua `priced` com zero', () => {
      const result = estimate(design([ecs, ec2]), catalog);
      expect(result.blocks[0]).toMatchObject({
        status: 'priced',
        lines: [],
        note: { kind: 'billed-on-host', hostBlockIds: [] },
      });
      expect(totals(result.blocks[0]!)).toEqual(ZEROS);
      expect(result.warnings).toEqual([{ code: 'missing-runs-on', blockId: 'blk_ecs' }]);
    });

    it('design só com blocos de custo zero tem total zero e não pede serviço do catálogo', () => {
      const blocks = [block('blk_iam', 'aws.iam'), block('blk_cfn', 'aws.cloudformation'), ecs];
      const result = estimate(design(blocks), catalog);
      expect(result.blocks.map((b) => b.status)).toEqual(['priced', 'priced', 'priced']);
      expect(totals(result)).toEqual(ZEROS);
      expect(catalogServices(design(blocks))).toEqual([]);
    });
  });

  it('não muda o custo dos outros blocos nem pede serviço a mais', () => {
    // Lambda do ADR: (3.000.000 − 1.000.000) × US$ 0,0000002 = US$ 0,40; duração na franquia.
    const paid = estimate(design([lambda]), loadedCatalog);
    const mixed = design([
      block('blk_iam', 'aws.iam'),
      lambda,
      block('blk_cfn', 'aws.cloudformation'),
      ecs,
    ]);
    const result = estimate(mixed, loadedCatalog);
    expect(totals(paid)).toEqual(['0.400000', '0.000000', '0.400000']);
    expect(totals(result)).toEqual(totals(paid));
    expect(result.blocks[1]).toEqual(paid.blocks[0]);
    expect(result.blocks[1]).not.toHaveProperty('note');
    expect(catalogServices(mixed)).toEqual(['lambda']);
  });

  it('só a aresta `runs-on` que parte do ECS e chega a um EC2 conta como host', () => {
    const blocks = [ecs, ec2, block('blk_s3', 'aws.s3'), block('blk_ecs2', 'aws.ecs')];
    const edges = [
      edge('edg_data', 'blk_ecs', 'blk_ec2', 'data'),
      edge('edg_s3', 'blk_ecs', 'blk_s3'),
      edge('edg_other', 'blk_ecs2', 'blk_ec2'),
      edge('edg_back', 'blk_ec2', 'blk_ecs'),
    ];
    const result = estimate(design(blocks, edges), emptyCatalog);
    expect(result.blocks[0]?.note).toEqual({ kind: 'billed-on-host', hostBlockIds: [] });
    expect(result.blocks[3]?.note).toEqual({ kind: 'billed-on-host', hostBlockIds: ['blk_ec2'] });
    expect(result.warnings).toEqual([{ code: 'missing-runs-on', blockId: 'blk_ecs' }]);
  });

  it('lista os hosts na ordem das arestas, sem repetir, e os avisos na ordem dos blocos', () => {
    const blocks = [
      block('blk_lone_b', 'aws.ecs'),
      ecs,
      block('blk_host_b', 'aws.ec2'),
      block('blk_host_a', 'aws.ec2'),
      block('blk_lone_a', 'aws.ecs'),
    ];
    const edges = [
      edge('edg_1', 'blk_ecs', 'blk_host_b'),
      edge('edg_2', 'blk_ecs', 'blk_host_a'),
      edge('edg_3', 'blk_ecs', 'blk_host_b'),
    ];
    const result = estimate(design(blocks, edges), emptyCatalog);
    expect(result.blocks[1]?.note).toEqual({
      kind: 'billed-on-host',
      hostBlockIds: ['blk_host_b', 'blk_host_a'],
    });
    expect(result.warnings.map((warning) => warning.blockId)).toEqual(['blk_lone_b', 'blk_lone_a']);
  });

  it('bloco `unavailable` não leva nota, mas o aviso do design continua', () => {
    const otherRegion = estimate(
      design([ecs, block('blk_iam', 'aws.iam')], [], 'sa-east-1'),
      emptyCatalog,
    );
    expect(otherRegion.blocks.map((b) => [b.status, b.note])).toEqual([
      ['unavailable', undefined],
      ['unavailable', undefined],
    ]);
    expect(otherRegion.warnings).toEqual([{ code: 'missing-runs-on', blockId: 'blk_ecs' }]);
    // `az` fora das opções do contrato: sem preço, como em qualquer bloco.
    const invalid = estimate(design([block('blk_ecs', 'aws.ecs', { az: 'z' })]), emptyCatalog);
    expect(invalid.blocks[0]).toMatchObject({ status: 'unavailable', lines: [] });
    expect(invalid.blocks[0]).not.toHaveProperty('note');
  });

  it('design sem bloco de custo zero não tem nota nem aviso', () => {
    const result = estimate(designDocumentSchema.parse(adrExampleDesign), loadedCatalog);
    expect(result.warnings).toEqual([]);
    result.blocks.forEach((b) => expect(b).not.toHaveProperty('note'));
  });
});

describe('zeroCostReport', () => {
  it('ignora função de preço comum e tipo fora do contrato, sem alterar o design', () => {
    const input = design([block('blk_x', 'aws.kinesis'), lambda, ecs]);
    const before = structuredClone(input);
    const report = zeroCostReport(input, blockPricer);
    expect([...report.notes.keys()]).toEqual(['blk_ecs']);
    expect(input).toEqual(before);
  });

  it('`zeroCostPricer` guarda a regra e `zeroCostRule` não a vê em função comum', () => {
    const rule = { kind: 'no-direct-cost' } as const;
    expect(zeroCostRule(zeroCostPricer(rule))).toBe(rule);
    expect(zeroCostRule(() => [])).toBeUndefined();
    expect(zeroCostRule(undefined)).toBeUndefined();
  });
});
