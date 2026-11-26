import { describe, expect, it, vi } from 'vitest';
import { applyEdgeChanges, applyNodeChanges } from './canvasHandlers';

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
