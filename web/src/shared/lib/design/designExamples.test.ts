import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { designDocumentSchema } from '.';

// Caminho de arquivo, não `URL`: no jsdom o `URL` global é o do jsdom, que o `fs` recusa.
const examples = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../../contracts/examples/design',
);
/** `JSON.parse` direto: import de JSON pelo Vite poderia tratar `"__proto__"` como literal de objeto. */
const load = (kind: 'valid' | 'invalid') => {
  const dir = resolve(examples, kind);
  return readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map(
      (file) => [file, JSON.parse(readFileSync(resolve(dir, file), 'utf8')) as unknown] as const,
    );
};

describe.each([
  ['valid', true],
  ['invalid', false],
] as const)(
  'exemplos compartilhados com a api (contracts/examples/design/%s)',
  (kind, accepted) => {
    const cases = load(kind);

    it('tem ao menos um exemplo', () => {
      expect(cases.length).toBeGreaterThan(0);
    });

    it.each(cases)(`${accepted ? 'aceita' : 'recusa'} %s`, (_file, document) => {
      expect(designDocumentSchema.safeParse(document).success).toBe(accepted);
    });
  },
);
