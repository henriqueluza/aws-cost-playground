import { describe, expect, it } from 'vitest';
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
