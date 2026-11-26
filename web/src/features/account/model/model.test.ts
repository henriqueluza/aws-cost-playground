import { describe, expect, it } from 'vitest';
import { ApiError, type ApiErrorKind } from '../../../shared/lib/api';
import {
  CONFIRM_WORD,
  confirmationMatches,
  accountErrorMessage,
  isRetryable,
} from './accountMessages';
import { formatResetsAt, quotaSummary } from './format';

const KINDS: ApiErrorKind[] = [
  'unauthenticated',
  'not-found',
  'version-conflict',
  'design-limit',
  'too-large',
  'unavailable',
  'invalid-request',
  'invalid-response',
  'network',
  'quota-exhausted',
];

describe('confirmationMatches', () => {
  it('aceita só a palavra exata, ignorando espaço nas pontas', () => {
    expect(confirmationMatches(CONFIRM_WORD)).toBe(true);
    expect(confirmationMatches(`  ${CONFIRM_WORD} `)).toBe(true);
    expect(confirmationMatches('excluir')).toBe(false);
    expect(confirmationMatches('EXCLUI')).toBe(false);
    expect(confirmationMatches('EXCLUIR conta')).toBe(false);
    expect(confirmationMatches('')).toBe(false);
  });
});

describe('mensagens por código', () => {
  it.each(KINDS)('%s tem frase própria, sem eco do erro', (kind) => {
    const echo = new ApiError({ kind } as never).message;
    expect(accountErrorMessage(kind)).not.toContain(echo);
  });
});

describe('formato', () => {
  it('quotaSummary concorda no singular e no plural', () => {
    expect(quotaSummary(17, 20)).toBe('Restam 17 de 20 estimativas por dia');
    expect(quotaSummary(1, 20)).toBe('Resta 1 de 20 estimativas por dia');
    expect(quotaSummary(0, 20)).toBe('Restam 0 de 20 estimativas por dia');
  });

  it('formatResetsAt usa pt-BR e devolve travessão para data inválida', () => {
    expect(formatResetsAt('2026-11-27T00:00:00Z', 'UTC')).toBe('27/11, 00:00');
    expect(formatResetsAt('ontem')).toBe('—');
  });
});
