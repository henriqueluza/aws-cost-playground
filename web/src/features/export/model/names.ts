/** Tamanho máximo de um nome de recurso gerado, já com o sufixo de colisão. */
export const MAX_NAME_LENGTH = 48;
/** Só os primeiros caracteres do texto entram no nome: limita o trabalho com entrada enorme. */
const MAX_SOURCE_LENGTH = 256;

/**
 * Nome de recurso do Terraform a partir de texto do usuário: só `[a-z0-9_]`, começando por letra.
 * Acentos são reduzidos à letra base; qualquer outra coisa vira `_`. Devolve `fallback` quando o
 * texto não deixa nenhuma letra ou dígito. Determinística: o mesmo texto dá sempre o mesmo nome.
 */
export function terraformName(text: string, fallback: string): string {
  const slug = (source: string) =>
    source
      .slice(0, MAX_SOURCE_LENGTH)
      .normalize('NFKD')
      .replace(/\p{M}+/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  const base = slug(text) || slug(fallback) || 'bloco';
  const named = /^[a-z]/.test(base) ? base : `r_${base}`;
  return named.slice(0, MAX_NAME_LENGTH).replace(/_+$/, '');
}

/**
 * Nomes únicos para uma lista de itens, na ordem recebida: o primeiro fica com o nome base e os
 * seguintes ganham `_2`, `_3`... O sufixo cabe em `MAX_NAME_LENGTH` e nunca repete um nome já dado.
 */
export function uniqueNames(
  items: readonly { readonly id: string; readonly text: string; readonly fallback: string }[],
): Map<string, string> {
  const taken = new Set<string>();
  const names = new Map<string, string>();
  for (const item of items) {
    const base = terraformName(item.text, item.fallback);
    let name = base;
    for (let n = 2; taken.has(name); n += 1) {
      const suffix = `_${n}`;
      name = `${base.slice(0, MAX_NAME_LENGTH - suffix.length).replace(/_+$/, '')}${suffix}`;
    }
    taken.add(name);
    names.set(item.id, name);
  }
  return names;
}
