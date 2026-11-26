import { effectiveUsage, type Block } from '../../../shared/lib/design';
import type { BlockDefinition, BlockPriceInput } from './blockContract';

/**
 * Entrada da função de preço de um bloco, conforme o contrato do tipo (`contracts/blocks.json`).
 * Uso: o efetivo (override vence), só com as chaves do contrato; chave ausente recebe o padrão,
 * valor fora da faixa é limitado a ela e chave inteira é arredondada para cima. Atributos: só os
 * do contrato; ausente recebe o padrão, se houver. Atributo com valor fora das opções não tem
 * preço: devolve `undefined`, e o bloco sai `unavailable`. O uso das arestas segue a mesma regra
 * (`edgeCharges`), com as chaves de `contracts/edges.json`.
 */
export function blockPriceInput(
  definition: Pick<BlockDefinition, 'attributes' | 'usage'>,
  block: Pick<Block, 'attributes' | 'usage' | 'overrides'>,
): BlockPriceInput | undefined {
  const attributes: Record<string, string | number> = {};
  for (const { key, options, default: fallback } of definition.attributes) {
    const value = block.attributes[key] ?? fallback;
    if (value === undefined) continue;
    const option = options.find((candidate) => candidate === value);
    if (option === undefined) return undefined;
    attributes[key] = option;
  }

  const informed = effectiveUsage(block.usage, block.overrides);
  const usage: Record<string, number> = {};
  for (const { key, default: fallback, min, max, integer } of definition.usage) {
    const value = Math.min(Math.max(informed[key] ?? fallback, min), max);
    usage[key] = integer ? Math.ceil(value) : value;
  }
  return { attributes, usage };
}
