import axe from 'axe-core';
import { expect } from 'vitest';

/**
 * Audita um trecho do DOM com o axe-core e falha com a lista de violações.
 *
 * `color-contrast` fica desligada: o jsdom não calcula layout nem cores e a regra daria resultado
 * falso. O contraste dos pares de tokens já é verificado nos dois temas (DESIGN.md, "Contraste
 * verificado", Issue #4).
 */
export async function expectNoAxeViolations(root: Element): Promise<void> {
  const { violations } = await axe.run(root, {
    rules: { 'color-contrast': { enabled: false } },
  });
  expect(
    violations.map((v) => ({ id: v.id, help: v.help, nodes: v.nodes.map((n) => n.html) })),
  ).toEqual([]);
}
