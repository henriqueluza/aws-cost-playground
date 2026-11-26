import { describe, expect, it } from 'vitest';
import {
  designDocumentSchema,
  type Block,
  type DesignDocument,
  type Edge,
} from '../../../shared/lib/design';
import { adrExampleDesign } from '../../../test/designFixtures';
import { buildExportModel } from './exportBlocks';

const block = (id: string, type: string, extra: Partial<Block> = {}): Block => ({
  id,
  type,
  label: id,
  attributes: {},
  usage: { source: 'default', values: {} },
  overrides: {},
  ...extra,
});
const edge = (id: string, source: string, target: string, kind: Edge['kind'] = 'data'): Edge => ({
  id,
  source,
  target,
  kind,
  usage: { source: 'default', values: {} },
  overrides: {},
});
const example = designDocumentSchema.parse(adrExampleDesign);
const design = (blocks: Block[], edges: Edge[] = []): DesignDocument => ({
  ...example,
  blocks,
  edges,
});

describe('buildExportModel', () => {
  it('entrega atributos do contrato com padrão e uso efetivo dentro da faixa', () => {
    const { blocks } = buildExportModel(example);
    expect(blocks.map((b) => [b.id, b.name])).toEqual([
      ['blk_assets', 'uploads'],
      ['blk_fn_api', 'api_handler'],
    ]);
    expect(blocks[1]).toMatchObject({
      type: 'aws.lambda',
      attributes: { architecture: 'arm64', memoryMb: 512 },
      usage: { requestsPerMonth: 3000000, avgDurationMs: 80 },
    });
  });

  it('descarta chave fora do contrato, aplica o padrão e limita o uso à faixa', () => {
    const { blocks } = buildExportModel(
      design([
        block('blk_a', 'aws.lambda', {
          attributes: { evil: '${file("/etc/passwd")}', memoryMb: 1024 },
          usage: { source: 'default', values: { avgDurationMs: 1e12, other: 5 } },
        }),
      ]),
    );
    expect(blocks[0]?.attributes).toEqual({ architecture: 'arm64', memoryMb: 1024 });
    expect(blocks[0]?.usage).toEqual({ requestsPerMonth: 1000000, avgDurationMs: 900000 });
  });

  it('recusa tipo desconhecido e atributo fora das opções, sem adivinhar', () => {
    const { blocks, rejected, links } = buildExportModel(
      design(
        [
          block('blk_a', 'aws.eks'),
          block('blk_b', 'aws.lambda', { attributes: { architecture: 'x86"\n' } }),
          block('blk_c', 'aws.sqs'),
        ],
        [edge('edg_1', 'blk_c', 'blk_b')],
      ),
    );
    expect(blocks.map((b) => b.id)).toEqual(['blk_c']);
    expect(rejected.map((b) => [b.id, b.reason])).toEqual([
      ['blk_a', 'unknown-type'],
      ['blk_b', 'invalid-attribute'],
    ]);
    expect(links.get('blk_c')).toEqual([]);
  });

  it('expõe as arestas dos dois lados, na ordem do id, com a internet sem par', () => {
    const { links } = buildExportModel(
      design(
        [block('blk_ecs', 'aws.ecs'), block('blk_ec2', 'aws.ec2'), block('blk_s3', 'aws.s3')],
        [
          edge('edg_3', 'blk_s3', 'client'),
          edge('edg_2', 'blk_ecs', 'blk_ec2', 'runs-on'),
          edge('edg_1', 'blk_ec2', 'blk_s3'),
        ],
      ),
    );
    const seen = (id: string) => links.get(id)?.map((l) => [l.kind, l.role, l.peer?.name]);
    expect(seen('blk_ec2')).toEqual([
      ['data', 'source', 'blk_s3'],
      ['runs-on', 'target', 'blk_ecs'],
    ]);
    expect(seen('blk_ecs')).toEqual([['runs-on', 'source', 'blk_ec2']]);
    expect(seen('blk_s3')).toEqual([
      ['data', 'target', 'blk_ec2'],
      ['data', 'source', undefined],
    ]);
  });
});
