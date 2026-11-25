// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ApiError, isApiError } from './index';

describe('ApiError', () => {
  it('tem mensagem fixa, nome e é um Error', () => {
    const error = new ApiError({ kind: 'not-found' });
    expect(error.message).toBe('Erro da API: not-found.');
    expect(error.name).toBe('ApiError');
    expect(error).toBeInstanceOf(Error);
  });
  it('quota-exhausted carrega scope e resetsAt', () => {
    const detail = {
      kind: 'quota-exhausted',
      scope: 'user',
      resetsAt: '2026-12-01T00:00:00Z',
    } as const;
    const error = new ApiError(detail);
    expect(error.kind).toBe('quota-exhausted');
    expect(error.detail).toEqual(detail);
  });
  it('preserva a causa', () => {
    const cause = new Error('origem');
    expect(new ApiError({ kind: 'network' }, { cause }).cause).toBe(cause);
  });
});

describe('isApiError', () => {
  const error = new ApiError({ kind: 'not-found' });
  it.each([
    ['sem kind', error, undefined, true],
    ['kind certo', error, 'not-found', true],
    ['outro kind', error, 'network', false],
    ['Error comum', new Error('x'), undefined, false],
    ['objeto com kind', { kind: 'not-found' }, 'not-found', false],
  ] as const)('%s', (_n, value, kind, expected) => {
    expect(isApiError(value, kind)).toBe(expected);
  });
});
