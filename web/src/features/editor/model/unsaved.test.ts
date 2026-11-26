import { describe, expect, it } from 'vitest';
import { EMPTY_DESIGN } from './editorState';
import { hasUnsavedChanges } from './unsaved';
import { referenceDesign } from './template/referenceTemplate';

describe('hasUnsavedChanges', () => {
  it('é falso para o mesmo documento e para uma cópia estrutural', () => {
    const design = referenceDesign();
    expect(hasUnsavedChanges(design, design)).toBe(false);
    expect(hasUnsavedChanges(referenceDesign(), referenceDesign())).toBe(false);
  });

  it('ignora a ordem das chaves', () => {
    const swapped = { ...EMPTY_DESIGN, region: 'us-east-1' as const };
    const reordered = Object.fromEntries(Object.entries(swapped).reverse()) as typeof swapped;
    expect(hasUnsavedChanges(reordered, EMPTY_DESIGN)).toBe(false);
  });

  it.each([
    [
      'a região',
      (d: ReturnType<typeof referenceDesign>) => ({ ...d, region: 'sa-east-1' as const }),
    ],
    [
      'a descrição',
      (d: ReturnType<typeof referenceDesign>) => ({ ...d, workload: { description: 'x' } }),
    ],
    [
      'um bloco a menos',
      (d: ReturnType<typeof referenceDesign>) => ({ ...d, blocks: d.blocks.slice(1) }),
    ],
    [
      'uma aresta a menos',
      (d: ReturnType<typeof referenceDesign>) => ({ ...d, edges: d.edges.slice(1) }),
    ],
    [
      'um valor de uso',
      (d: ReturnType<typeof referenceDesign>) => ({
        ...d,
        blocks: d.blocks.map((b, i) =>
          i === 0 ? { ...b, overrides: { ...b.overrides, requestsPerMonth: 1 } } : b,
        ),
      }),
    ],
  ])('é verdadeiro quando muda %s', (_name, change) => {
    const saved = referenceDesign();
    expect(hasUnsavedChanges(change(saved), saved)).toBe(true);
  });
});
