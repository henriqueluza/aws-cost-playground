import { describe, expect, it } from 'vitest';
import {
  appliedMessage,
  blockedReason,
  failureMessage,
  failureOf,
  lockOf,
  quotaLine,
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

const FUTURE = '2999-01-01T00:00:00.000Z';
const PAST = '2020-01-01T00:00:00.000Z';
const NOW = Date.parse('2026-11-26T12:00:00.000Z');

describe('appliedMessage e quotaLine', () => {
  it('conta no singular e no plural; sem nada aproveitável diz que nada mudou', () => {
    expect(appliedMessage(1, 1)).toBe('Estimativa aplicada: 1 bloco e 1 conexão.');
    expect(appliedMessage(3, 2)).toBe('Estimativa aplicada: 3 blocos e 2 conexões.');
    expect(appliedMessage(0, 0)).toMatch(/não trouxe valores utilizáveis; nada foi alterado/);
  });

  it('linha da quota restante', () => {
    expect(quotaLine({ limit: 5, remaining: 3 })).toBe('Restam 3 de 5 hoje');
  });
});

describe('blockedReason', () => {
  const lock: EstimateFailure = { kind: 'quota-user', resetsAt: FUTURE };
  it('ordem: sem blocos, sem descrição, trava de quota; livre é null', () => {
    expect(blockedReason({ blocks: 0, description: '', locked: lock })).toMatch(/Adicione blocos/);
    expect(blockedReason({ blocks: 2, description: '  ', locked: lock })).toMatch(
      /Descreva a carga/,
    );
    expect(blockedReason({ blocks: 2, description: 'x', locked: lock })).toBe(failureMessage(lock));
    expect(blockedReason({ blocks: 2, description: 'x', locked: null })).toBeNull();
  });
});

describe('lockOf', () => {
  const user = (resetsAt: string): EstimateFailure => ({ kind: 'quota-user', resetsAt });
  it('falha de quota vale até a hora de voltar, e só ela', () => {
    expect(lockOf(user(FUTURE), null, NOW)).toEqual(user(FUTURE));
    expect(lockOf({ kind: 'quota-global', resetsAt: FUTURE }, null, NOW)?.kind).toBe(
      'quota-global',
    );
    expect(lockOf(user(PAST), null, NOW)).toBeNull();
    expect(lockOf({ kind: 'unavailable' }, null, NOW)).toBeNull();
    expect(lockOf(null, null, NOW)).toBeNull();
  });

  it('quota zerada trava até resetsAt; com saldo ou vencida solta', () => {
    expect(lockOf(null, { remaining: 0, resetsAt: FUTURE }, NOW)).toEqual(user(FUTURE));
    expect(lockOf(null, { remaining: 0, resetsAt: PAST }, NOW)).toBeNull();
    expect(lockOf(null, { remaining: 3, resetsAt: FUTURE }, NOW)).toBeNull();
  });
});
