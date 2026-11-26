import { describe, expect, it } from 'vitest';
import * as m from './messages';
import { failureMessage, failureOf, type EstimateFailure } from './messages';

const RESET = '2026-11-27T00:00:00.000Z';

describe('failureOf', () => {
  it.each([
    [{ kind: 'unauthenticated' }, 'sign-in'],
    [{ kind: 'quota-exhausted', scope: 'user', resetsAt: RESET }, 'quota-user'],
    [{ kind: 'quota-exhausted', scope: 'global', resetsAt: RESET }, 'quota-global'],
    [{ kind: 'unavailable' }, 'unavailable'],
    [{ kind: 'network' }, 'network'],
    [{ kind: 'too-large' }, 'too-large'],
    [{ kind: 'not-found' }, 'unusable'],
    [{ kind: 'invalid-response' }, 'unusable'],
  ] as const)('%j -> %s', (detail, kind) => {
    expect(failureOf(detail).kind).toBe(kind);
  });
});

describe('failureMessage', () => {
  const all: EstimateFailure[] = [
    { kind: 'sign-in' },
    { kind: 'quota-user', resetsAt: RESET },
    { kind: 'quota-user', resetsAt: 'não é data' },
    { kind: 'quota-global', resetsAt: RESET },
    { kind: 'unavailable' },
    { kind: 'network' },
    { kind: 'too-large' },
    { kind: 'unusable' },
  ];

  it('toda falha tem frase própria, sem marcação', () => {
    for (const failure of all) {
      const text = failureMessage(failure);
      expect(text.length).toBeGreaterThan(10);
      expect(text).not.toMatch(/[<>]/);
    }
  });

  it('503, falta de rede e 413 têm frases diferentes', () => {
    const texts = (['unavailable', 'network', 'too-large'] as const).map((kind) =>
      failureMessage({ kind }),
    );
    expect(new Set(texts).size).toBe(3);
    expect(texts[0]).toMatch(/indisponível/);
  });

  it('a quota do usuário diz quando volta, ou "amanhã" se a data não vale; nunca promete que não contou', () => {
    expect(failureMessage({ kind: 'quota-user', resetsAt: RESET })).toMatch(
      /voltam às \d{2}:\d{2}/,
    );
    expect(failureMessage({ kind: 'quota-user', resetsAt: 'x' })).toMatch(/voltam amanhã/);
    expect(failureMessage({ kind: 'quota-global', resetsAt: RESET })).toMatch(/volta amanhã/);
    for (const failure of all)
      expect(failureMessage(failure)).not.toMatch(/não (foi|será) (conta|consum)/);
  });
});

describe('appliedMessage, quotaLine e quotaRatio', () => {
  it('zero, singular e plural', () => {
    expect(m.appliedMessage(0, 0)).toContain('não trouxe valores utilizáveis');
    expect(m.appliedMessage(1, 1)).toBe('Estimativa aplicada: 1 bloco e 1 conexão.');
    expect(m.appliedMessage(3, 0)).toBe('Estimativa aplicada: 3 blocos e 0 conexões.');
  });
  it('linha 0 de 20 e proporção limitada a 0..1 (limite 0 dá 0)', () => {
    expect(m.quotaLine({ limit: 20, remaining: 0 })).toBe('Restam 0 de 20 hoje');
    expect(m.quotaRatio({ limit: 0, remaining: 0 })).toBe(0);
    expect(m.quotaRatio({ limit: 20, remaining: 99 })).toBe(1);
  });
});

describe('blockedReason e lockOf', () => {
  const locked: EstimateFailure = { kind: 'quota-user', resetsAt: RESET };
  const now = Date.parse('2026-11-26T12:00:00.000Z');
  const past = '2026-11-26T00:00:00.000Z';
  it('blockedReason: sem blocos, sem descrição, quota, livre (nessa ordem)', () => {
    expect(m.blockedReason({ blocks: 0, description: '', locked })).toMatch(/Adicione blocos/);
    expect(m.blockedReason({ blocks: 2, description: ' ', locked })).toMatch(/Descreva a carga/);
    expect(m.blockedReason({ blocks: 2, description: 'x', locked })).toBe(failureMessage(locked));
    expect(m.blockedReason({ blocks: 2, description: 'x', locked: null })).toBeNull();
  });
  it('lockOf: falha de quota e remaining 0 travam até a hora de voltar', () => {
    expect(m.lockOf(locked, null, now)).toBe(locked);
    expect(m.lockOf({ ...locked, resetsAt: past }, null, now)).toBeNull();
    expect(m.lockOf(null, { remaining: 0, resetsAt: RESET }, now)).toEqual(locked);
    expect(m.lockOf(null, { remaining: 0, resetsAt: past }, now)).toBeNull();
  });
});
