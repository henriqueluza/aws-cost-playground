import { describe, expect, it } from 'vitest';
import { BLOCKS } from '../../pricing';
import { attributeLabel, optionLabel, unitLabel, usageLabel } from './blockLabels';

describe('rótulos em pt-BR dos 20 blocos', () => {
  it('cobre os 20 blocos do contrato', () => {
    expect(BLOCKS).toHaveLength(20);
  });

  it.each(BLOCKS.map((b) => [b.type, b] as const))(
    '%s: rótulo para toda chave e opção',
    (_t, def) => {
      for (const attribute of def.attributes) {
        expect(attributeLabel(attribute.key), `atributo ${attribute.key}`).toBeTruthy();
        for (const option of attribute.options) {
          expect(optionLabel(attribute.key, option), `${attribute.key}=${option}`).toBeTruthy();
        }
      }
      for (const key of def.usage) {
        expect(usageLabel(key.key), `uso ${key.key}`).toBeTruthy();
        expect(unitLabel(key.unit), `unidade ${key.unit}`).toBeTruthy();
      }
    },
  );

  it('memória em MB com separador de milhar; chave desconhecida não tem rótulo', () => {
    expect(optionLabel('memoryMb', 10240)).toBe('10.240 MB');
    expect(optionLabel('engine', 'oracle')).toBeUndefined();
    expect(usageLabel('constructor')).toBeUndefined();
    expect(attributeLabel('toString')).toBeUndefined();
    expect(optionLabel('constructor', 'x')).toBeUndefined();
    expect(optionLabel('engine', 'constructor')).toBeUndefined();
  });
});
