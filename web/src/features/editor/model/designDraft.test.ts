import { describe, expect, it } from 'vitest';
import { adrExampleDesign } from '../../../test/designFixtures';
import { designDocumentSchema } from '../../../shared/lib/design';
import { DRAFT_TTL_MS, saveDesignDraft, takeDesignDraft } from './designDraft';

const KEY = 'aws-cost-playground:design-draft';
const DOC = designDocumentSchema.parse(adrExampleDesign);
const T0 = 1_795_608_000_000;

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, value),
  };
}

describe('designDraft', () => {
  it('devolve o design guardado uma vez só e o apaga', () => {
    const storage = memoryStorage();
    expect(saveDesignDraft(DOC, () => T0, storage)).toBe(true);
    expect(takeDesignDraft(() => T0 + 1_000, storage)).toEqual(DOC);
    expect(storage.length).toBe(0);
    expect(takeDesignDraft(() => T0, storage)).toBeNull();
  });

  it('o rascunho vencido não volta, e some', () => {
    const storage = memoryStorage();
    saveDesignDraft(DOC, () => T0, storage);
    expect(takeDesignDraft(() => T0 + DRAFT_TTL_MS + 1, storage)).toBeNull();
    expect(storage.length).toBe(0);
  });

  it.each([
    'não é json',
    '{"savedAt":1}',
    JSON.stringify({ savedAt: T0, text: '{"lixo":1}' }),
    JSON.stringify({ savedAt: T0, text: 'não é json' }),
    JSON.stringify({ savedAt: 'ontem', text: '{}' }),
  ])('conteúdo inválido (%s) é ignorado e apagado', (raw) => {
    const storage = memoryStorage();
    storage.setItem(KEY, raw);
    expect(takeDesignDraft(() => T0, storage)).toBeNull();
    expect(storage.length).toBe(0);
  });

  it('guarda só o documento: nenhum token nem dado de conta', () => {
    const storage = memoryStorage();
    saveDesignDraft(DOC, () => T0, storage);
    const saved = JSON.parse(storage.getItem(KEY) ?? '{}') as Record<string, unknown>;
    expect(Object.keys(saved).sort()).toEqual(['savedAt', 'text']);
  });

  it('armazenamento que lança nunca lança', () => {
    const fail = () => {
      throw new Error('bloqueado');
    };
    const broken = { getItem: fail, setItem: fail, removeItem: fail } as unknown as Storage;
    expect(saveDesignDraft(DOC, () => T0, broken)).toBe(false);
    expect(takeDesignDraft(() => T0, broken)).toBeNull();
  });
});
