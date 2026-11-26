import { describe, expect, it, vi } from 'vitest';
import { designDocumentSchema } from '../../../shared/lib/design';
import { adrExampleDesign } from '../../../test/designFixtures';
import {
  applyEdgeChanges,
  applyNodeChanges,
  connectBlocks,
  refusalMessage,
} from './canvasHandlers';
import { createDesignStore } from './designStore';

const actions = () => ({
  moveBlock: vi.fn(),
  removeBlock: vi.fn(),
  removeEdge: vi.fn(),
  select: vi.fn(),
});

describe('applyNodeChanges', () => {
  it('traduz mover, remover e selecionar em ações da store', () => {
    const a = actions();
    applyNodeChanges(
      [
        { type: 'position', id: 'blk_a', position: { x: 8, y: 16 } },
        { type: 'remove', id: 'blk_b' },
        { type: 'select', id: 'blk_a', selected: true },
        { type: 'dimensions', id: 'blk_a' },
      ],
      a,
      null,
      'client',
    );
    expect(a.moveBlock).toHaveBeenCalledExactlyOnceWith('blk_a', { x: 8, y: 16 });
    expect(a.removeBlock).toHaveBeenCalledExactlyOnceWith('blk_b');
    expect(a.select).toHaveBeenCalledExactlyOnceWith({ kind: 'block', id: 'blk_a' });
  });

  it('nunca remove o client e ignora posição ausente', () => {
    const a = actions();
    applyNodeChanges(
      [
        { type: 'remove', id: 'client' },
        { type: 'position', id: 'blk_a' },
      ],
      a,
      null,
      'client',
    );
    expect(a.removeBlock).not.toHaveBeenCalled();
    expect(a.moveBlock).not.toHaveBeenCalled();
  });

  it('limpa a seleção ao desmarcar o selecionado, mas não ao desmarcar outro', () => {
    const a = actions();
    const current = { kind: 'block', id: 'blk_a' } as const;
    applyNodeChanges([{ type: 'select', id: 'blk_a', selected: false }], a, current, 'client');
    expect(a.select).toHaveBeenCalledExactlyOnceWith(null);
    const b = actions();
    applyNodeChanges([{ type: 'select', id: 'blk_z', selected: false }], b, current, 'client');
    expect(b.select).not.toHaveBeenCalled();
  });

  it('em seleção trocada, o novo vence o desmarcar do antigo', () => {
    const a = actions();
    applyNodeChanges(
      [
        { type: 'select', id: 'blk_a', selected: false },
        { type: 'select', id: 'blk_b', selected: true },
      ],
      a,
      { kind: 'block', id: 'blk_a' },
      'client',
    );
    expect(a.select).toHaveBeenCalledExactlyOnceWith({ kind: 'block', id: 'blk_b' });
  });
});

describe('applyEdgeChanges', () => {
  it('remove e seleciona aresta pelas ações da store', () => {
    const a = actions();
    applyEdgeChanges(
      [
        { type: 'remove', id: 'edg_1' },
        { type: 'select', id: 'edg_2', selected: true },
      ],
      a,
      null,
    );
    expect(a.removeEdge).toHaveBeenCalledExactlyOnceWith('edg_1');
    expect(a.select).toHaveBeenCalledExactlyOnceWith({ kind: 'edge', id: 'edg_2' });
  });

  it('desmarcar aresta não apaga a seleção de bloco', () => {
    const a = actions();
    applyEdgeChanges([{ type: 'select', id: 'edg_1', selected: false }], a, {
      kind: 'block',
      id: 'blk_a',
    });
    expect(a.select).not.toHaveBeenCalled();
  });
});

describe('conectar pela store', () => {
  const document = designDocumentSchema.parse({
    ...adrExampleDesign,
    edges: [],
    blocks: [
      ...adrExampleDesign.blocks,
      { ...adrExampleDesign.blocks[0]!, id: 'blk_iam', type: 'aws.iam', attributes: {} },
    ],
  });
  const storeOf = () => createDesignStore({ document, layout: {}, selection: null });

  it('conexão do contrato cria a aresta pela ação `connect` e não devolve recusa', () => {
    const store = storeOf();
    expect(
      connectBlocks({ source: 'blk_fn_api', target: 'blk_assets' }, store.getState()),
    ).toBeNull();
    expect(store.getState().document.edges).toMatchObject([
      { source: 'blk_fn_api', target: 'blk_assets', kind: 'data' },
    ]);
  });

  it('conexão fora do contrato devolve a explicação e não altera o design', () => {
    const store = storeOf();
    const message = connectBlocks({ source: 'blk_iam', target: 'blk_fn_api' }, store.getState());
    expect(message).toContain('IAM não se conecta com Lambda');
    expect(store.getState().document.edges).toEqual([]);
  });

  it('explica a recusa do React Flow e cala quando o par vale', () => {
    expect(refusalMessage(document, { source: 'blk_fn_api', target: 'client' })).toContain(
      'internet',
    );
    expect(refusalMessage(document, { source: 'blk_fn_api', target: 'blk_assets' })).toBeNull();
  });
});

describe('anúncios (say)', () => {
  const current = { kind: 'block', id: 'blk_a' } as const;
  it('remoção aceita diz "Bloco removido" por último; recusada não diz nada', () => {
    const say = vi.fn();
    const a = { ...actions(), removeBlock: vi.fn(() => ({ ok: true as const, value: undefined })) };
    applyNodeChanges(
      [
        { type: 'remove', id: 'blk_a' },
        { type: 'select', id: 'blk_a', selected: false },
      ],
      a,
      current,
      'client',
      say,
    );
    expect(say.mock.calls.map(([m]) => m)).toEqual(['Seleção removida', 'Bloco removido']);
    const refused = vi.fn();
    const b = {
      ...actions(),
      removeBlock: vi.fn(() => ({ ok: false as const, error: { code: 'unknown-block' as const } })),
    };
    applyNodeChanges([{ type: 'remove', id: 'blk_a' }], b, null, 'client', refused);
    expect(refused).not.toHaveBeenCalled();
  });

  it('remover aresta diz "Conexão removida"; limpar a seleção diz "Seleção removida"', () => {
    const say = vi.fn();
    applyEdgeChanges([{ type: 'remove', id: 'edg_1' }], actions(), null, say);
    expect(say).toHaveBeenCalledExactlyOnceWith('Conexão removida');
    const clear = vi.fn();
    applyNodeChanges(
      [{ type: 'select', id: 'blk_a', selected: false }],
      actions(),
      current,
      'client',
      clear,
    );
    expect(clear).toHaveBeenCalledExactlyOnceWith('Seleção removida');
  });
});
