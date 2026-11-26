import { describe, expect, it } from 'vitest';
import { BLOCKS } from '../../../pricing';
import { BLOCK_GENERATORS, PROVISIONAL_BLOCK_TYPES } from './index';

describe('registro dos geradores', () => {
  it('tem um gerador para cada bloco do contrato, sem sobrar nenhum', () => {
    expect(Object.keys(BLOCK_GENERATORS).sort()).toEqual(BLOCKS.map((block) => block.type).sort());
    for (const block of BLOCKS) expect(BLOCK_GENERATORS[block.type]).toBeTypeOf('function');
  });

  /**
   * Lista escrita à mão dos blocos que ainda não geram recurso. Quem entrega um gerador real
   * (#65, #66, #67) tira o tipo daqui; a lista fica vazia quando os 20 estiverem prontos.
   */
  it('lista os blocos que ainda estão no gerador provisório', () => {
    expect([...PROVISIONAL_BLOCK_TYPES].sort()).toEqual([]);
  });
});
