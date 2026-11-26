import { describe, expect, it } from 'vitest';
import { blockCountLabel, formatUpdatedAt } from './format';

describe('format', () => {
  it('formata a data em pt-BR e recusa o que não é data', () => {
    expect(formatUpdatedAt('2026-11-26T14:30:00Z', 'UTC')).toBe('26/11/2026, 14:30');
    expect(formatUpdatedAt('lixo')).toBe('—');
  });

  it('concorda o plural de blocos', () => {
    expect(blockCountLabel(0)).toBe('0 blocos');
    expect(blockCountLabel(1)).toBe('1 bloco');
    expect(blockCountLabel(3)).toBe('3 blocos');
  });
});
