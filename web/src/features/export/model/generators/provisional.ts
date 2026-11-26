import type { BlockGenerator } from '../generator';
import { hcl } from '../hcl';

/** Gerador provisório: o bloco ainda não vira recurso e sai como comentário, nunca some. */
export const notSupportedYet: BlockGenerator = () => ({
  exported: false,
  nodes: [hcl.comment('Não suportado ainda: este bloco não gera recursos nesta versão do export.')],
});
