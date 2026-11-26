import { describe, expect, it } from 'vitest';
import {
  appliedMessage,
  blockedReason,
  failureMessage,
  failureOf,
  lockOf,
  quotaLine,
  quotaRatio,
  type EstimateFailure,
} from './messages';

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

describe('appliedMessage', () => {
  it('sem valor aproveitável, diz que nada foi alterado', () => {
    expect(appliedMessage(0, 0)).toContain('não trouxe valores utilizáveis');
  });
  it('singular e plural', () => {
    expect(appliedMessage(1, 1)).toBe('Estimativa aplicada: 1 bloco e 1 conexão.');
    expect(appliedMessage(3, 0)).toBe('Estimativa aplicada: 3 blocos e 0 conexões.');
  });
});

describe('quotaLine e quotaRatio', () => {
  it('escreve a linha da quota, inclusive 0 de 20', () => {
    expect(quotaLine({ limit: 20, remaining: 0 })).toBe('Restam 0 de 20 hoje');
    expect(quotaLine({ limit: 20, remaining: 12 })).toBe('Restam 12 de 20 hoje');
  });
  it('proporção entre 0 e 1, e 0 quando o limite é 0', () => {
    expect(quotaRatio({ limit: 0, remaining: 0 })).toBe(0);
    expect(quotaRatio({ limit: 1, remaining: 1 })).toBe(1);
    expect(quotaRatio({ limit: 20, remaining: 5 })).toBe(0.25);
    expect(quotaRatio({ limit: 20, remaining: 0 })).toBe(0);
    expect(quotaRatio({ limit: 20, remaining: 99 })).toBe(1);
    expect(quotaRatio({ limit: 20, remaining: -3 })).toBe(0);
  });
});

describe('blockedReason', () => {
  const locked: EstimateFailure = { kind: 'quota-user', resetsAt: RESET };
  it('ordem: sem blocos, sem descrição, quota travada, livre', () => {
    expect(blockedReason({ blocks: 0, description: '', locked })).toMatch(/Adicione blocos/);
    expect(blockedReason({ blocks: 2, description: '   ', locked })).toMatch(/Descreva a carga/);
    expect(blockedReason({ blocks: 2, description: 'x', locked })).toBe(failureMessage(locked));
    expect(blockedReason({ blocks: 2, description: 'x', locked: null })).toBeNull();
  });
});

describe('lockOf', () => {
  const now = Date.parse('2026-11-26T12:00:00.000Z');
  const future = '2026-11-27T00:00:00.000Z';
  const past = '2026-11-26T00:00:00.000Z';
  it('falha de quota aberta trava; vencida solta', () => {
    const open: EstimateFailure = { kind: 'quota-global', resetsAt: future };
    expect(lockOf(open, null, now)).toBe(open);
    expect(lockOf({ kind: 'quota-user', resetsAt: past }, null, now)).toBeNull();
  });
  it('remaining 0 com resetsAt futuro trava; passado solta', () => {
    expect(lockOf(null, { remaining: 0, resetsAt: future }, now)).toEqual({
      kind: 'quota-user',
      resetsAt: future,
    });
    expect(lockOf(null, { remaining: 0, resetsAt: past }, now)).toBeNull();
  });
  it('outras falhas e quota com saldo não travam', () => {
    expect(lockOf({ kind: 'network' }, { remaining: 3, resetsAt: future }, now)).toBeNull();
    expect(lockOf(null, null, now)).toBeNull();
  });
});
