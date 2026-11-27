import { describe, expect, it } from 'vitest';
import { CONFIRM_WORD, confirmationMatches } from './accountMessages';
import { formatResetsAt, quotaSummary } from './format';

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

describe('formato', () => {
  it('quotaSummary concorda no singular e no plural', () => {
    expect(quotaSummary(3, 5)).toBe('Restam 3 de 5 estimativas por dia');
    expect(quotaSummary(1, 5)).toBe('Resta 1 de 5 estimativas por dia');
    expect(quotaSummary(0, 5)).toBe('Restam 0 de 5 estimativas por dia');
  });

  it('formatResetsAt usa pt-BR e devolve travessão para data inválida', () => {
    expect(formatResetsAt('2026-11-27T00:00:00Z', 'UTC')).toBe('27/11, 00:00');
    expect(formatResetsAt('ontem')).toBe('—');
  });
});
