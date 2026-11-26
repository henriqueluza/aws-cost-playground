import { describe, expect, it, vi } from 'vitest';
import { designDocumentSchema } from '../../../shared/lib/design';
import { adrExampleDesign } from '../../../test/designFixtures';
import type { EditorState, NewBlock } from '../model/editorState';
import { createDesignStore, randomIds, type IdSource } from './designStore';

const doc = designDocumentSchema.parse(adrExampleDesign);
const layout = { blk_fn_api: { x: 1, y: 2 }, blk_assets: { x: 3, y: 4 }, client: { x: 5, y: 6 } };
const initial: EditorState = { document: doc, layout, selection: null };
const newBlock: NewBlock = {
  type: 'aws.s3',
  label: 'Novo',
  attributes: { storageClass: 'STANDARD' },
  usage: { source: 'default', values: { storageGb: 1 } },
};
const fakeIds = (): IdSource => {
  let b = 0;
  let e = 0;
  return { blockId: () => `blk_t${++b}`, edgeId: () => `edg_t${++e}` };
};
const setup = (state: EditorState = initial) => createDesignStore(state, fakeIds());
const block = { kind: 'block', id: 'blk_assets' } as const;
const edge = { kind: 'edge', id: 'edg_1' } as const;

describe('designStore: caminho feliz das 12 ações', () => {
  it('addBlock e moveBlock', () => {
    const s = setup();
    expect(s.getState().addBlock(newBlock, { x: 9, y: 8 })).toEqual({ ok: true, value: 'blk_t1' });
    const added = s.getState().document.blocks.find((b) => b.id === 'blk_t1');
    expect(added?.overrides).toEqual({});
    expect(s.getState().layout.blk_t1).toEqual({ x: 9, y: 8 });
    const docBefore = s.getState().document;
    expect(s.getState().moveBlock('client', { x: 7, y: 7 }).ok).toBe(true);
    expect(s.getState().layout.client).toEqual({ x: 7, y: 7 });
    expect(s.getState().document).toBe(docBefore);
  });

  it('editBlock, setUsage, setOverride e setRegion', () => {
    const s = setup();
    s.getState().editBlock('blk_assets', { label: 'Renomeado' });
    s.getState().setUsage(block, { source: 'default', values: { storageGb: 7 } });
    s.getState().setOverride(block, 'storageGb', 9);
    s.getState().setRegion('sa-east-1');
    const b = s.getState().document.blocks.find((x) => x.id === 'blk_assets');
    expect(b?.label).toBe('Renomeado');
    expect(b?.usage.values.storageGb).toBe(7);
    expect(b?.overrides.storageGb).toBe(9);
    expect(s.getState().document.region).toBe('sa-east-1');
    s.getState().setOverride(block, 'storageGb', null);
    expect(s.getState().document.blocks[1]?.overrides.storageGb).toBeUndefined();
  });

  it('connect, select, removeEdge e removeBlock', () => {
    const s = setup();
    const r = s.getState().connect({ source: 'blk_fn_api', target: 'blk_assets', kind: 'data' });
    expect(r).toEqual({ ok: true, value: 'edg_t1' });
    const created = s.getState().document.edges.find((e) => e.id === 'edg_t1');
    expect(created?.usage).toEqual({ source: 'default', values: {} });
    expect(s.getState().select({ kind: 'edge', id: 'edg_t1' }).ok).toBe(true);
    s.getState().removeEdge('edg_t1');
    expect(s.getState().selection).toBeNull();
    expect(s.getState().select(block).ok).toBe(true);
    expect(s.getState().select(null).ok).toBe(true);
    expect(s.getState().removeBlock('blk_fn_api').ok).not.toBe(false);
    expect(s.getState().document.blocks.map((b) => b.id)).toEqual(['blk_assets']);
  });

  it('loadDesign filtra o layout e zera a seleção', () => {
    const s = setup({ ...initial, selection: block });
    const raw = { ...adrExampleDesign };
    const bad = { blk_fn_api: { x: 1, y: 1 }, fantasma: { x: 2, y: 2 }, client: { x: 3, y: 3 } };
    const r = s.getState().loadDesign(raw, { ...bad, blk_assets: { x: Infinity, y: 0 } });
    expect(r.ok).toBe(true);
    expect(s.getState().layout).toEqual({ blk_fn_api: { x: 1, y: 1 }, client: { x: 3, y: 3 } });
    expect(s.getState().selection).toBeNull();
    s.getState().loadDesign(raw);
    expect(s.getState().layout).toEqual({});
  });
});

describe('designStore: ação recusada não altera o estado', () => {
  it.each([
    [
      'connect com target inexistente',
      (s: ReturnType<typeof setup>) =>
        s.getState().connect({ source: 'blk_fn_api', target: 'blk_x', kind: 'data' }),
    ],
    [
      'addBlock com posição NaN',
      (s: ReturnType<typeof setup>) => s.getState().addBlock(newBlock, { x: NaN, y: 0 }),
    ],
    [
      'select inexistente',
      (s: ReturnType<typeof setup>) => s.getState().select({ kind: 'block', id: 'blk_x' }),
    ],
    ['loadDesign de lixo', (s: ReturnType<typeof setup>) => s.getState().loadDesign({ lixo: 1 })],
    [
      'moveBlock desconhecido',
      (s: ReturnType<typeof setup>) => s.getState().moveBlock('blk_x', { x: 0, y: 0 }),
    ],
  ])('%s', (_nome, run) => {
    const s = setup();
    const listener = vi.fn();
    s.subscribe(listener);
    const before = s.getState();
    expect(run(s).ok).toBe(false);
    expect(s.getState()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('designStore: cascata e substituição', () => {
  it('removeBlock leva arestas, layout e seleção', () => {
    const s = setup({ ...initial, selection: edge });
    s.getState().removeBlock('blk_assets');
    expect(s.getState().document.edges).toEqual([]);
    expect(s.getState().layout).not.toHaveProperty('blk_assets');
    expect(s.getState().selection).toBeNull();
  });

  it('replaceDocument mantém sobreviventes e descarta o que sumiu', () => {
    const s = setup({ ...initial, selection: block });
    s.getState().replaceDocument({ ...doc, blocks: [doc.blocks[1]!], edges: [] });
    expect(s.getState().layout).toEqual({ blk_assets: layout.blk_assets, client: layout.client });
    expect(s.getState().selection).toEqual(block);
    s.getState().replaceDocument({ ...doc, blocks: [doc.blocks[0]!], edges: [] });
    expect(s.getState().selection).toBeNull();
  });

  it('randomIds gera ids que passam no schema', () => {
    const s = createDesignStore(initial, randomIds);
    const a = s.getState().addBlock(newBlock, { x: 0, y: 0 });
    const c = s.getState().connect({ source: 'blk_fn_api', target: 'blk_assets', kind: 'logs' });
    expect(a.ok && c.ok).toBe(true);
    expect(() => designDocumentSchema.parse(s.getState().document)).not.toThrow();
  });
});
