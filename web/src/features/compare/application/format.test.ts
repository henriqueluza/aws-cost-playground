import { describe, expect, it } from 'vitest';
import { decimal } from '../../../shared/lib/money';
import { blockTypeLabel, edgeKindLabel, formatDiff, plural } from './format';

describe('format', () => {
  it.each([
    ['12.4', '+US$ 12,40'],
    ['-3.1', '−US$ 3,10'],
    ['0', 'US$ 0,00'],
    ['1234.567', '+US$ 1.234,57'],
    ['0.005', '< +US$ 0,01'],
    ['-0.005', '> −US$ 0,01'],
  ])('formatDiff %s = %s', (value, text) => {
    expect(formatDiff(decimal(value))).toBe(text);
  });

  it('rótulos: do contrato, ou o próprio texto se desconhecido', () => {
    expect(blockTypeLabel('aws.ec2')).toMatch(/EC2/);
    expect(blockTypeLabel('<b>x</b>')).toBe('<b>x</b>');
    expect(edgeKindLabel('runs-on')).toBe('Executa em');
    expect(plural(1, 'bloco', 'blocos')).toBe('1 bloco');
    expect(plural(2, 'bloco', 'blocos')).toBe('2 blocos');
  });
});
