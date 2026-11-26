import { describe, expect, it } from 'vitest';
import { EMPTY_DESIGN } from './editorState';
import {
  EMPTY_HISTORY,
  HISTORY_LIMIT,
  record,
  redo,
  stepText,
  undo,
  type Snapshot,
} from './history';

const snap = (n: number): Snapshot => ({ document: EMPTY_DESIGN, layout: { a: { x: n, y: 0 } } });

describe('history (puro)', () => {
  it('registra, desfaz e refaz sem mutar o histórico anterior', () => {
    const h1 = record(EMPTY_HISTORY, snap(0), 'move-block');
    expect(EMPTY_HISTORY.past).toHaveLength(0);
    const u = undo(h1, snap(1));
    expect(u?.snapshot).toEqual(snap(0));
    expect(u?.kind).toBe('move-block');
    expect(u?.history.past).toHaveLength(0);
    expect(u?.history.future).toHaveLength(1);
    expect(h1.past).toHaveLength(1);
    const r = redo(u!.history, snap(0));
    expect(r?.snapshot).toEqual(snap(1));
    expect(r?.history.past).toHaveLength(1);
  });

  it('sem passo, desfazer e refazer devolvem null', () => {
    expect(undo(EMPTY_HISTORY, snap(0))).toBeNull();
    expect(redo(EMPTY_HISTORY, snap(0))).toBeNull();
  });

  it('ação nova depois de desfazer limpa o futuro', () => {
    const h = record(EMPTY_HISTORY, snap(0), 'add-block');
    const u = undo(h, snap(1))!;
    expect(record(u.history, snap(0), 'remove-block').future).toEqual([]);
  });

  it('tem teto: o passo mais antigo cai primeiro', () => {
    let h = EMPTY_HISTORY;
    for (let i = 0; i < HISTORY_LIMIT + 25; i++) h = record(h, snap(i), 'move-block');
    expect(h.past).toHaveLength(HISTORY_LIMIT);
    expect(h.past[0]?.layout.a?.x).toBe(25);
  });

  it('o mesmo grupo dentro da janela é um passo; fora dela ou de outro grupo, outro', () => {
    const g = (key: string, now: number) => ({ key, now, windowMs: 100 });
    let h = record(EMPTY_HISTORY, snap(0), 'move-block', g('k', 0));
    h = record(h, snap(1), 'move-block', g('k', 50));
    expect(h.past).toHaveLength(1);
    expect(h.past[0]?.layout.a?.x).toBe(0); // guarda o estado de antes da sequência
    h = record(h, snap(2), 'move-block', g('k', 140)); // 50 + 100 = 150: ainda dentro
    expect(h.past).toHaveLength(1);
    h = record(h, snap(3), 'move-block', g('k', 400));
    expect(h.past).toHaveLength(2);
    h = record(h, snap(4), 'move-block', g('outro', 401));
    expect(h.past).toHaveLength(3);
  });

  it('depois de desfazer, o grupo não é retomado', () => {
    const g = { key: 'k', now: 0, windowMs: 1000 };
    const h = record(EMPTY_HISTORY, snap(0), 'move-block', g);
    const u = undo(h, snap(1))!;
    const r = redo(u.history, snap(0))!;
    expect(r.history.past[0]?.group).toBeNull();
  });

  it('todo tipo de passo tem texto em pt-BR', () => {
    expect(stepText('move-block')).toBe('mover bloco');
    expect(stepText('replace-design')).toBe('substituir design');
  });
});
