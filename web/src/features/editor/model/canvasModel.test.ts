import { describe, expect, it } from 'vitest';
import { designDocumentSchema } from '../../../shared/lib/design';
import { decimal } from '../../../shared/lib/money';
import { adrExampleDesign } from '../../../test/designFixtures';
import {
  canvasCategory,
  defaultLayout,
  formatUsd,
  toCanvasEdges,
  toCanvasNodes,
  type BlockNodeData,
} from './canvasModel';

const doc = designDocumentSchema.parse(adrExampleDesign);
const costs = new Map([['blk_fn_api', { text: 'US$ 5,73', zero: false }]]);

describe('toCanvasNodes', () => {
  const nodes = toCanvasNodes(doc, {}, null, costs);

  it('põe o client primeiro, fixo e não removível', () => {
    expect(nodes[0]).toMatchObject({ id: 'client', type: 'client', deletable: false });
    expect(nodes[0]?.selectable).toBe(false);
  });

  it('dá a cada bloco categoria, custo e nome acessível com tipo, rótulo e custo', () => {
    const lambda = nodes[1];
    expect(lambda?.data).toMatchObject({
      category: 'compute',
      cost: 'US$ 5,73',
      service: 'Lambda',
    });
    expect(lambda?.ariaLabel).toBe('Lambda, API handler, Computação, US$ 5,73 por mês');
    const s3 = nodes[2];
    expect((s3?.data as BlockNodeData).cost).toBe('—');
    expect(s3?.ariaLabel).toContain('custo ainda sem valor');
  });

  it('usa a posição do layout e, sem ela, a grade padrão', () => {
    const placed = toCanvasNodes(doc, { blk_assets: { x: 7, y: 9 } }, null, costs);
    expect(placed[2]?.position).toEqual({ x: 7, y: 9 });
    expect(placed[1]?.position).toEqual(defaultLayout(doc).blk_fn_api);
  });

  it('põe o fluxo da esquerda para a direita, com o client na última coluna', () => {
    const chain = {
      ...doc,
      blocks: ['blk_a', 'blk_b', 'blk_c'].map((id) => ({ ...doc.blocks[0]!, id })),
      edges: [
        { ...doc.edges[0]!, id: 'edg_1', source: 'blk_a', target: 'blk_b' },
        { ...doc.edges[0]!, id: 'edg_2', source: 'blk_b', target: 'blk_c' },
        { ...doc.edges[0]!, id: 'edg_3', source: 'blk_a', target: 'blk_c' },
        { ...doc.edges[0]!, id: 'edg_5', source: 'blk_c', target: 'client' },
      ],
    };
    const at = defaultLayout(chain);
    expect([at.blk_a?.x, at.blk_b?.x, at.blk_c?.x, at.client?.x]).toEqual([0, 288, 576, 864]);
  });

  it('termina com um ciclo no design', () => {
    const loop = {
      ...doc,
      blocks: ['blk_a', 'blk_b'].map((id) => ({ ...doc.blocks[0]!, id })),
      edges: [
        { ...doc.edges[0]!, id: 'edg_1', source: 'blk_a', target: 'blk_b' },
        { ...doc.edges[0]!, id: 'edg_2', source: 'blk_b', target: 'blk_a' },
      ],
    };
    expect(Object.keys(defaultLayout(loop))).toEqual(['blk_a', 'blk_b', 'client']);
  });

  it('marca só o bloco selecionado', () => {
    const picked = toCanvasNodes(doc, {}, { kind: 'block', id: 'blk_assets' }, costs);
    expect(picked.map((n) => n.selected)).toEqual([false, false, true]);
  });

  it('guarda a marcação do rótulo como texto, sem interpretá-la', () => {
    const evil = '<img src=x onerror=alert(1)>';
    const [, block] = toCanvasNodes(
      { ...doc, blocks: [{ ...doc.blocks[0]!, label: evil }] },
      {},
      null,
      costs,
    );
    expect((block?.data as BlockNodeData).label).toBe(evil);
  });

  it('cai no nome do serviço quando o rótulo é vazio e avisa que o custo do ECS está no EC2', () => {
    const ecs = { ...doc.blocks[0]!, id: 'blk_ecs', type: 'aws.ecs', label: ' ', attributes: {} };
    const [, node] = toCanvasNodes({ ...doc, blocks: [ecs], edges: [] }, {}, null, new Map());
    expect(node?.data).toMatchObject({ label: 'ECS', costNote: 'custo no EC2' });
  });
});

describe('toCanvasEdges', () => {
  it('descreve a aresta e marca a selecionada', () => {
    const [edge] = toCanvasEdges(doc, { kind: 'edge', id: 'edg_1' });
    expect(edge).toMatchObject({ source: 'blk_assets', target: 'client', selected: true });
    expect(edge?.ariaLabel).toBe('Dados: S3 para Internet');
  });
});

describe('formatUsd e categoria', () => {
  it('formata em dólar com separadores brasileiros', () => {
    expect(formatUsd(decimal('1234567.891'))).toBe('US$ 1.234.567,89');
    expect(formatUsd(decimal(0))).toBe('US$ 0,00');
  });

  it('agrupa os 20 tipos nas cinco categorias do desenho', () => {
    expect(canvasCategory('aws.sqs')).toBe('data');
    expect(canvasCategory('aws.codepipeline')).toBe('ops');
    expect(canvasCategory('aws.alb')).toBe('network');
    expect(canvasCategory('aws.desconhecido')).toBeNull();
  });
});
