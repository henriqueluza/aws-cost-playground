import { describe, expect, it } from 'vitest';
import { adrExampleDesign, designWithBlocks } from '../../../test/designFixtures';
import {
  DESIGN_LIMITS,
  designDocumentSchema,
  type Block,
  type DesignDocument,
  type Edge,
} from '../../../shared/lib/design';
import type { ActionErrorCode, ElementRef, Result } from './editorState';
import {
  addBlock,
  connect,
  editBlock,
  parseDesign,
  removeBlock,
  removeEdge,
  setOverride,
  setRegion,
  setUsage,
} from './designActions';

const doc: DesignDocument = adrExampleDesign;
const [lambda, s3] = adrExampleDesign.blocks;
const [edge1] = adrExampleDesign.edges;
const full = designWithBlocks(DESIGN_LIMITS.maxBlocks) as DesignDocument;
const newEdge: Edge = { ...edge1, id: 'edg_2', source: 'blk_fn_api', target: 'blk_assets' };
const usage = { source: 'default', values: { requestsPerMonth: 7 } } as const;
const blockRef: ElementRef = { kind: 'block', id: 'blk_fn_api' };
const edgeRef: ElementRef = { kind: 'edge', id: 'edg_1' };

const refused = <T>(result: Result<T>) => (result.ok ? 'ok' : result.error.code);
const accepted = (result: Result<DesignDocument>): DesignDocument => {
  if (!result.ok) throw new Error(`recusada: ${result.error.code}`);
  expect(designDocumentSchema.safeParse(result.value).success).toBe(true);
  return result.value;
};
const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
};

describe('addBlock', () => {
  it('põe o bloco no fim da lista', () => {
    const block: Block = { ...s3, id: 'blk_novo' };
    expect(accepted(addBlock(doc, block)).blocks.map((b) => b.id)).toEqual([
      'blk_fn_api',
      'blk_assets',
      'blk_novo',
    ]);
  });

  it.each<[string, DesignDocument, Block, ActionErrorCode]>([
    ['id repetido', doc, { ...s3, id: 'blk_fn_api' }, 'duplicate-id'],
    ['documento no limite de blocos', full, { ...s3, id: 'blk_extra' }, 'limit-exceeded'],
    [
      'label com 81 caracteres',
      doc,
      { ...s3, id: 'blk_a', label: 'x'.repeat(81) },
      'invalid-document',
    ],
    ['type sem o prefixo aws.', doc, { ...s3, id: 'blk_b', type: 'lambda' }, 'invalid-document'],
  ])('recusa: %s', (_, target, block, code) => {
    expect(refused(addBlock(target, block))).toBe(code);
  });
});

describe('editBlock', () => {
  it('muda label e substitui attributes, sem tocar em type, usage e overrides', () => {
    const edited = accepted(
      editBlock(doc, 'blk_fn_api', { label: 'Novo', attributes: { memoryMb: 1024 } }),
    );
    expect(edited.blocks[0]).toEqual({ ...lambda, label: 'Novo', attributes: { memoryMb: 1024 } });
  });

  it('recusa bloco inexistente', () => {
    expect(refused(editBlock(doc, 'blk_nada', { label: 'x' }))).toBe('unknown-block');
  });
});

describe('removeBlock', () => {
  it('remove o bloco e em cascata as arestas ligadas a ele', () => {
    const removed = accepted(removeBlock(doc, 'blk_assets'));
    expect(removed.blocks.map((b) => b.id)).toEqual(['blk_fn_api']);
    expect(removed.edges).toEqual([]);
  });

  it('recusa bloco inexistente', () => {
    expect(refused(removeBlock(doc, 'blk_nada'))).toBe('unknown-block');
  });
});

describe('connect', () => {
  it('liga dois blocos', () => {
    expect(accepted(connect(doc, newEdge)).edges.map((e) => e.id)).toEqual(['edg_1', 'edg_2']);
  });

  it('aceita aresta repetida com outro id', () => {
    expect(accepted(connect(doc, { ...edge1, id: 'edg_9' })).edges).toHaveLength(2);
  });

  it.each<[string, Edge, ActionErrorCode]>([
    ['source inexistente', { ...newEdge, source: 'blk_nada' }, 'unknown-block'],
    ['target inexistente', { ...newEdge, target: 'blk_nada' }, 'unknown-block'],
    ['laço no mesmo bloco', { ...newEdge, target: 'blk_fn_api' }, 'self-loop'],
    ['logs para o client', { ...newEdge, target: 'client', kind: 'logs' }, 'client-edge-kind'],
    ['id de aresta repetido', { ...newEdge, id: 'edg_1' }, 'duplicate-id'],
  ])('recusa: %s', (_, edge, code) => {
    expect(refused(connect(doc, edge))).toBe(code);
  });
});

describe('removeEdge', () => {
  it('remove a aresta e mantém os blocos', () => {
    const removed = accepted(removeEdge(doc, 'edg_1'));
    expect(removed.edges).toEqual([]);
    expect(removed.blocks).toHaveLength(2);
  });

  it('recusa aresta inexistente', () => {
    expect(refused(removeEdge(doc, 'edg_nada'))).toBe('unknown-edge');
  });
});

describe('setUsage', () => {
  it('troca o usage do bloco sem tocar nos overrides', () => {
    const [block] = accepted(setUsage(doc, blockRef, usage)).blocks;
    expect(block.usage).toEqual(usage);
    expect(block.overrides).toEqual({ avgDurationMs: 80 });
  });

  it('troca o usage da aresta', () => {
    expect(accepted(setUsage(doc, edgeRef, usage)).edges[0].usage).toEqual(usage);
  });

  it.each<[ElementRef, ActionErrorCode]>([
    [{ kind: 'block', id: 'blk_nada' }, 'unknown-block'],
    [{ kind: 'edge', id: 'edg_nada' }, 'unknown-edge'],
  ])('recusa alvo inexistente %j', (target, code) => {
    expect(refused(setUsage(doc, target, usage))).toBe(code);
  });
});

describe('setOverride', () => {
  it('define a chave no bloco e na aresta', () => {
    const set = accepted(setOverride(doc, blockRef, 'requestsPerMonth', 5));
    expect(set.blocks[0].overrides).toEqual({ avgDurationMs: 80, requestsPerMonth: 5 });
    expect(accepted(setOverride(doc, edgeRef, 'gbPerMonth', 9)).edges[0].overrides).toEqual({
      gbPerMonth: 9,
    });
  });

  it('null remove a chave; remover chave ausente é ok', () => {
    expect(accepted(setOverride(doc, blockRef, 'avgDurationMs', null)).blocks[0].overrides).toEqual(
      {},
    );
    expect(accepted(setOverride(doc, blockRef, 'storageGb', null)).blocks[0].overrides).toEqual({
      avgDurationMs: 80,
    });
  });

  it.each<[string, ElementRef, number, ActionErrorCode]>([
    ['valor negativo', blockRef, -1, 'invalid-document'],
    ['NaN', blockRef, NaN, 'invalid-document'],
    ['bloco inexistente', { kind: 'block', id: 'blk_nada' }, 1, 'unknown-block'],
    ['aresta inexistente', { kind: 'edge', id: 'edg_nada' }, 1, 'unknown-edge'],
  ])('recusa: %s', (_, target, value, code) => {
    expect(refused(setOverride(doc, target, 'avgDurationMs', value))).toBe(code);
  });
});

describe('setRegion', () => {
  it('troca a região', () => {
    expect(accepted(setRegion(doc, 'sa-east-1')).region).toBe('sa-east-1');
  });
});

describe('parseDesign', () => {
  it('aceita o exemplo do ADR', () => {
    expect(accepted(parseDesign(structuredClone(adrExampleDesign)))).toEqual(adrExampleDesign);
  });

  it.each<[string, unknown]>([
    ['null', null],
    ['texto', 'lixo'],
    ['id de bloco repetido', { ...doc, blocks: [lambda, lambda] }],
    ['aresta para bloco inexistente', { ...doc, edges: [{ ...edge1, source: 'blk_nada' }] }],
  ])('recusa %s com só o código, sem mensagem do zod', (_, raw) => {
    const result = parseDesign(raw);
    expect(result).toEqual({ ok: false, error: { code: 'invalid-document' } });
  });
});

describe('imutabilidade', () => {
  it('não lança nem altera um documento congelado em profundidade', () => {
    const frozen = deepFreeze(structuredClone(adrExampleDesign)) as DesignDocument;
    const before = structuredClone(adrExampleDesign);
    const run = [
      () => addBlock(frozen, { ...s3, id: 'blk_novo' }),
      () => editBlock(frozen, 'blk_fn_api', { label: 'N', attributes: {} }),
      () => removeBlock(frozen, 'blk_assets'),
      () => connect(frozen, newEdge),
      () => removeEdge(frozen, 'edg_1'),
      () => setUsage(frozen, blockRef, usage),
      () => setOverride(frozen, blockRef, 'avgDurationMs', null),
      () => setRegion(frozen, 'sa-east-1'),
      () => removeBlock(frozen, 'blk_nada'),
    ];
    run.forEach((action) => expect(action).not.toThrow());
    expect(frozen).toEqual(before);
  });
});
