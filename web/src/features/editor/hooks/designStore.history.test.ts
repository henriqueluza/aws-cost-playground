import { describe, expect, it } from 'vitest';
import { designDocumentSchema } from '../../../shared/lib/design';
import { adrExampleDesign } from '../../../test/designFixtures';
import type { EditorState, NewBlock } from '../model/editorState';
import { HISTORY_LIMIT } from '../model/history';
import { createDesignStore, type DesignStore } from './designStore';

const doc = designDocumentSchema.parse(adrExampleDesign);
const layout = { blk_fn_api: { x: 8, y: 8 }, blk_assets: { x: 80, y: 8 }, client: { x: 0, y: 0 } };
const initial: EditorState = { document: doc, layout, selection: null };
const newBlock: NewBlock = {
  type: 'aws.s3',
  label: 'Novo',
  attributes: { storageClass: 'STANDARD' },
  usage: { source: 'default', values: { storageGb: 1 } },
};
const setup = (clock = () => 0): DesignStore => {
  let n = 0;
  return createDesignStore(
    initial,
    { blockId: () => `blk_t${++n}`, edgeId: () => `edg_t${n}` },
    clock,
  );
};
const past = (s: DesignStore) => s.getState().history.past.length;
const view = (s: DesignStore) => ({ document: s.getState().document, layout: s.getState().layout });

/** Uma chamada que muda o documento ou o layout, por ação. Ação nova sem entrada aqui falha. */
const MUTATIONS: Record<string, (s: DesignStore) => void> = {
  addBlock: (s) => void s.getState().addBlock(newBlock, { x: 40, y: 40 }),
  moveBlock: (s) => void s.getState().moveBlock('blk_assets', { x: 1, y: 1 }),
  removeBlock: (s) => void s.getState().removeBlock('blk_assets'),
  editBlock: (s) => void s.getState().editBlock('blk_fn_api', { label: 'Outro nome' }),
  connect: (s) =>
    void s.getState().connect({ source: 'blk_assets', target: 'blk_fn_api', kind: 'data' }),
  removeEdge: (s) => void s.getState().removeEdge('edg_1'),
  setUsage: (s) =>
    void s
      .getState()
      .setUsage(
        { kind: 'block', id: 'blk_fn_api' },
        { source: 'llm', values: { requestsPerMonth: 5 } },
      ),
  setOverride: (s) =>
    void s.getState().setOverride({ kind: 'block', id: 'blk_fn_api' }, 'requestsPerMonth', 7),
  setRegion: (s) => void s.getState().setRegion('sa-east-1'),
  loadDesign: (s) =>
    void s.getState().loadDesign({ ...doc, workload: { description: 'Carregado' } }),
  replaceDocument: (s) =>
    void s.getState().replaceDocument({ ...doc, workload: { description: 'Trocado' } }),
};
/** Ações que não tocam o documento nem o layout: não entram no histórico. */
const NOT_DOCUMENT = ['select', 'undo', 'redo', 'beginGesture', 'endGesture'];

describe('histórico: toda ação da store é desfazível', () => {
  const actions = Object.entries(setup().getState())
    .filter(([, v]) => typeof v === 'function')
    .map(([k]) => k)
    .filter((k) => !NOT_DOCUMENT.includes(k));

  it('a lista de ações exportadas e a de mutações cobrem as mesmas', () => {
    expect([...actions].sort()).toEqual(Object.keys(MUTATIONS).sort());
  });

  it.each(actions)('%s: um passo, desfaz ao estado de antes e refaz ao de depois', (name) => {
    const s = setup();
    const before = view(s);
    MUTATIONS[name]?.(s);
    const after = view(s);
    expect(after).not.toEqual(before); // a mutação mudou algo...
    expect(past(s)).toBe(1); // ...e entrou no histórico
    expect(s.getState().undo()).not.toBeNull();
    expect(view(s)).toEqual(before);
    expect(s.getState().redo()).not.toBeNull();
    expect(view(s)).toEqual(after);
  });

  it('ação recusada, select e arrasto sem mudança não entram', () => {
    const s = setup();
    s.getState().removeBlock('nao_existe');
    s.getState().moveBlock('blk_assets', { x: Number.NaN, y: 0 });
    s.getState().moveBlock('blk_assets', layout.blk_assets);
    s.getState().select({ kind: 'block', id: 'blk_assets' });
    expect(past(s)).toBe(0);
    expect(s.getState().undo()).toBeNull();
  });
});

describe('histórico: agrupamento, seleção e substituição', () => {
  it('um arrasto (gesto) é um passo só, desfeito de uma vez', () => {
    const s = setup();
    s.getState().beginGesture();
    for (let x = 1; x <= 50; x++) s.getState().moveBlock('blk_assets', { x: 80 + x, y: 8 });
    s.getState().endGesture();
    expect(past(s)).toBe(1);
    s.getState().beginGesture();
    s.getState().moveBlock('blk_assets', { x: 300, y: 8 });
    s.getState().endGesture();
    expect(past(s)).toBe(2);
    s.getState().undo();
    s.getState().undo();
    expect(s.getState().layout.blk_assets).toEqual({ x: 80, y: 8 });
  });

  it('setas em sequência (pausa < 1 s) são um passo; depois da pausa, outro', () => {
    let now = 0;
    const s = setup(() => now);
    for (let i = 1; i <= 5; i++) {
      now += 200;
      s.getState().moveBlock('blk_assets', { x: 80 + 8 * i, y: 8 });
    }
    expect(past(s)).toBe(1);
    now += 5000;
    s.getState().moveBlock('blk_assets', { x: 200, y: 8 });
    expect(past(s)).toBe(2);
    s.getState().moveBlock('blk_fn_api', { x: 9, y: 9 }); // outro bloco: outro passo
    expect(past(s)).toBe(3);
  });

  it('ação nova depois de desfazer limpa o futuro', () => {
    const s = setup();
    s.getState().setRegion('sa-east-1');
    s.getState().undo();
    expect(s.getState().history.future).toHaveLength(1);
    s.getState().setRegion('us-east-1');
    expect(s.getState().history.future).toHaveLength(0);
  });

  it('desfazer limpa a seleção que aponta para algo inexistente; zoom e seleção não são passos', () => {
    const s = setup();
    s.getState().addBlock(newBlock, { x: 1, y: 1 });
    s.getState().select({ kind: 'block', id: 'blk_t1' });
    expect(past(s)).toBe(1);
    s.getState().undo();
    expect(s.getState().selection).toBeNull();
    s.getState().redo();
    expect(s.getState().selection).toBeNull();
  });

  it('desfazer remover bloco devolve bloco, arestas e posição', () => {
    const s = setup();
    const before = view(s);
    s.getState().removeBlock('blk_assets'); // leva a aresta edg_1 junto
    expect(s.getState().document.edges).toHaveLength(0);
    s.getState().undo();
    expect(view(s)).toEqual(before);
  });

  it('substituir o design é um passo desfazível único e o histórico nunca aponta para bloco inexistente', () => {
    const s = setup();
    s.getState().setRegion('sa-east-1');
    s.getState().loadDesign({ ...doc, blocks: [], edges: [], workload: { description: 'Novo' } });
    expect(s.getState().layout).toEqual({});
    expect(past(s)).toBe(2);
    s.getState().undo(); // volta ao design e às posições de antes do arquivo
    expect(s.getState().document.blocks).toHaveLength(doc.blocks.length);
    expect(s.getState().layout).toEqual(layout);
    s.getState().undo();
    s.getState().undo(); // sem passo: nada acontece
    expect(view(s)).toEqual(view(setup()));
  });

  it('o teto de passos vale na store', () => {
    const s = setup();
    for (let i = 0; i < HISTORY_LIMIT + 10; i++) {
      s.getState().setRegion(i % 2 ? 'us-east-1' : 'sa-east-1');
    }
    expect(past(s)).toBe(HISTORY_LIMIT);
  });
});
