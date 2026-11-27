import { describe, expect, it } from 'vitest';
import { adrExampleDesign } from '../../../test/designFixtures';
import type { DesignDocument } from '../../../shared/lib/design';
import { designErrorMessage, isRetryable } from './designMessages';
import { saveStatus, sameDocument, type SavedDesign } from './saveState';

const doc = adrExampleDesign as unknown as DesignDocument;
const saved = (d: DesignDocument): SavedDesign => ({ id: 'X', name: 'N', version: 1, doc: d });
const changed: DesignDocument = { ...doc, region: 'sa-east-1' };

describe('estado do salvamento', () => {
  it('compara documentos sem depender da ordem das chaves', () => {
    const reverse = (v: unknown): unknown =>
      Array.isArray(v)
        ? v.map(reverse)
        : typeof v === 'object' && v !== null
          ? Object.fromEntries(
              Object.entries(v)
                .reverse()
                .map(([k, x]) => [k, reverse(x)]),
            )
          : v;
    const reordered = reverse(doc);
    expect(sameDocument(doc, reordered)).toBe(true);
    expect(sameDocument(doc, changed)).toBe(false);
    expect(sameDocument([1], { 0: 1 })).toBe(false);
  });

  it.each([
    ['salvando vence tudo', doc, saved(changed), true, 'saving'],
    ['nunca salvo', doc, null, false, 'unsaved'],
    ['igual ao salvo', doc, saved(doc), false, 'saved'],
    ['diferente do salvo', changed, saved(doc), false, 'dirty'],
  ] as const)('%s', (_n, current, last, saving, expected) => {
    expect(saveStatus(current, last, saving)).toBe(expected);
  });
});

describe('textos', () => {
  it('cada código tem frase própria e o limite diz 10', () => {
    expect(designErrorMessage('design-limit')).toBe('Você atingiu o limite de 10 designs.');
    expect(designErrorMessage('unauthenticated')).toMatch(/Entre/);
    expect(isRetryable('network')).toBe(true);
    expect(isRetryable('too-large')).toBe(false);
  });
});
