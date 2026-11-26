import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  DESIGN_LIMITS,
  designDocumentSchema,
  type DesignDocument,
} from '../../../shared/lib/design';
import { adrExampleDesign } from '../../../test/designFixtures';
import {
  designFileMessage,
  migrateDesign,
  parseDesignFile,
  readDesignFile,
  serializeDesign,
  type DesignFileError,
} from './designFile';

const contracts = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../contracts');
const files = (dir: string) =>
  readdirSync(resolve(contracts, dir))
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => [f, readFileSync(resolve(contracts, dir, f), 'utf8')] as const);

const design = designDocumentSchema.parse(adrExampleDesign);
const withBlocks = (count: number): string =>
  JSON.stringify({
    ...design,
    edges: [],
    blocks: Array.from({ length: count }, (_, i) => ({ ...design.blocks[0], id: `blk_${i}` })),
  });
const asFile = (text: string) => ({
  size: new TextEncoder().encode(text).length,
  text: () => Promise.resolve(text),
});
const errorOf = (text: string): DesignFileError | undefined => {
  const r = parseDesignFile(text);
  return r.ok ? undefined : r.error;
};

describe('bateria de exemplos compartilhados', () => {
  it.each(files('examples/design/valid'))('abre o válido %s', (_n, text) => {
    expect(parseDesignFile(text).ok).toBe(true);
  });
  it.each(files('examples/design/invalid'))('recusa o inválido %s', (_n, text) => {
    expect(parseDesignFile(text).ok).toBe(false);
  });
  it.each(files('scenarios'))('abre o cenário %s', (_n, text) => {
    expect(parseDesignFile(text).ok).toBe(true);
  });
  it('tem arquivos nas duas pastas', () => {
    expect(files('examples/design/valid').length).toBeGreaterThanOrEqual(14);
    expect(files('examples/design/invalid').length).toBeGreaterThanOrEqual(41);
  });
});

describe('categorias de erro', () => {
  it('não é JSON', () => {
    for (const text of ['', 'oi', '{"a":', "{'a':1}", '\u0000'])
      expect(errorOf(text)).toBe('not-json');
  });
  it('não é um design deste produto', () => {
    for (const text of [
      'null',
      '[]',
      '42',
      '"x"',
      '{}',
      JSON.stringify({ ...design, region: 'x' }),
      JSON.stringify({ ...design, schemaVersion: '1' }),
    ]) {
      expect(errorOf(text)).toBe('not-design');
    }
  });
  it('versão desconhecida, futura ou anterior sem migração', () => {
    for (const v of [0, 2, 99, -1]) {
      expect(errorOf(JSON.stringify({ ...design, schemaVersion: v }))).toBe('unsupported-version');
    }
  });
  it('arquivo grande demais é recusado sem ser lido', async () => {
    const text = vi.fn(() => Promise.resolve('{}'));
    const r = await readDesignFile({ size: DESIGN_LIMITS.maxDocBytes + 1, text });
    expect(r).toEqual({ ok: false, error: 'too-large' });
    expect(text).not.toHaveBeenCalled();
  });
  it('o teto vale no limite exato', async () => {
    const text = vi.fn(() => Promise.resolve('{}'));
    expect(await readDesignFile({ size: DESIGN_LIMITS.maxDocBytes, text })).toEqual({
      ok: false,
      error: 'not-design',
    });
    expect(text).toHaveBeenCalledOnce();
  });
  it('falha de leitura vira "unreadable"', async () => {
    const r = await readDesignFile({
      size: 1,
      text: () => Promise.reject(new Error('/Users/x/secreto')),
    });
    expect(r).toEqual({ ok: false, error: 'unreadable' });
  });
  it('mais de 100 blocos é recusado, 100 abrem', () => {
    expect(errorOf(withBlocks(DESIGN_LIMITS.maxBlocks + 1))).toBe('not-design');
    expect(parseDesignFile(withBlocks(DESIGN_LIMITS.maxBlocks)).ok).toBe(true);
  });
  it('a mensagem é texto próprio e nunca eco do arquivo', () => {
    const secret = 'SEGREDO_NO_ARQUIVO';
    const bad = [
      `{"${secret}":`,
      JSON.stringify({ ...design, region: secret }),
      JSON.stringify({ ...design, schemaVersion: 7, x: secret }),
    ];
    for (const text of bad) {
      const r = parseDesignFile(text);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(designFileMessage(r.error)).not.toContain(secret);
        expect(designFileMessage(r.error)).not.toMatch(/Unexpected|zod|path|position|JSON\.parse/i);
      }
    }
  });
});

describe('arquivo malicioso', () => {
  it('__proto__ em qualquer nível não polui o protótipo e é descartado', () => {
    const before = Object.getOwnPropertyNames(Object.prototype).sort();
    const text = readFileSync(
      resolve(contracts, 'examples/design/valid/fields-32-keys-plus-proto.json'),
      'utf8',
    );
    const polluted = text.replace(
      '{',
      '{"__proto__":{"polluted":"sim"},"constructor":{"prototype":{"polluted":"sim"}},',
    );
    const r = parseDesignFile(polluted);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getOwnPropertyNames(Object.prototype).sort()).toEqual(before);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(Object.hasOwn(r.document, '__proto__')).toBe(false);
      expect(Object.hasOwn(r.document, 'constructor')).toBe(false);
      expect(serializeDesign(r.document)).not.toMatch(/__proto__|polluted/);
    }
  });
  it('__proto__ e constructor como chave de uso são tratados como o schema manda', () => {
    const doc = JSON.parse(JSON.stringify(design)) as DesignDocument;
    const raw = JSON.stringify(doc).replace(
      '"overrides":{"avgDurationMs":80}',
      '"overrides":{"__proto__":{"polluted":1},"constructor":5}',
    );
    expect(raw).toContain('__proto__');
    expect(errorOf(raw)).toBe('not-design'); // `constructor` é nome de Object.prototype: recusado
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
  it('rótulo com marcação abre como texto e volta idêntico', () => {
    const label = '<img src=x onerror=alert(1)><script>x</script>';
    const r = parseDesignFile(
      JSON.stringify({ ...design, blocks: [{ ...design.blocks[0], label }], edges: [] }),
    );
    expect(r.ok && r.document.blocks[0]?.label).toBe(label);
  });
  it('números fora de faixa e ids duplicados são recusados', () => {
    const b = design.blocks[0];
    const usage = (values: Record<string, number | string>) => ({
      ...b,
      usage: { ...b?.usage, values },
    });
    for (const v of [-1, 1e13, 'NaN', '1e999']) {
      expect(errorOf(JSON.stringify({ ...design, blocks: [usage({ requestsPerMonth: v })] }))).toBe(
        'not-design',
      );
    }
    expect(errorOf('{"schemaVersion":1,"x":1e999}')).toBe('not-design');
    expect(errorOf(JSON.stringify({ ...design, blocks: [b, b], edges: [] }))).toBe('not-design');
  });
  it('aninhamento profundo dentro do teto não derruba a leitura', () => {
    const depth = Math.floor(DESIGN_LIMITS.maxDocBytes / 2) - 10;
    const deep = '['.repeat(depth) + ']'.repeat(depth);
    expect(['not-json', 'not-design']).toContain(errorOf(deep));
    expect(errorOf(`{"a":${'['.repeat(100_000)}${']'.repeat(100_000)}}`)).toBeDefined();
  });
});

describe('ponto de migração', () => {
  it('a versão atual passa sem mexer', () => {
    expect(migrateDesign(design)).toEqual({ ok: true, raw: design });
  });
  it('aplica os passos até a versão atual, na ordem', () => {
    const steps = {
      1: (r: unknown) => ({ ...(r as object), schemaVersion: 2, a: 1 }),
      2: (r: unknown) => ({ ...(r as object), schemaVersion: 3, b: 1 }),
    };
    expect(migrateDesign({ schemaVersion: 1 }, steps, 3)).toEqual({
      ok: true,
      raw: { schemaVersion: 3, a: 1, b: 1 },
    });
  });
  it('versão sem passo, futura, não inteira ou passo que não avança é recusada', () => {
    expect(migrateDesign({ schemaVersion: 1 }, {}, 3)).toEqual({
      ok: false,
      error: 'unsupported-version',
    });
    expect(migrateDesign({ schemaVersion: 4 }, {}, 3)).toEqual({
      ok: false,
      error: 'unsupported-version',
    });
    expect(migrateDesign({ schemaVersion: 1 }, { 1: (r) => r }, 3)).toEqual({
      ok: false,
      error: 'unsupported-version',
    });
    expect(migrateDesign({ schemaVersion: 1 }, { 1: () => 'x' }, 3)).toEqual({
      ok: false,
      error: 'unsupported-version',
    });
    // 1.5 e texto ficam para o schema, que os recusa como "não é um design"
    expect(errorOf(JSON.stringify({ ...design, schemaVersion: 1.5 }))).toBe('not-design');
  });
  it('não consulta Object.prototype como se fosse passo', () => {
    expect(migrateDesign({ schemaVersion: 1 }, {}, 3).ok).toBe(false);
    expect(migrateDesign({ __proto__: null, schemaVersion: 0 }, {}, 1).ok).toBe(false);
  });
});

describe('serialização', () => {
  it('é determinística e só leva as chaves do contrato', () => {
    const noisy = {
      ...design,
      session: { token: 't' },
      email: 'a@b.c',
    } as unknown as DesignDocument;
    const text = serializeDesign(noisy);
    expect(text).toBe(serializeDesign(design));
    expect(text).not.toMatch(/token|email|session/);
    expect(text?.endsWith('}\n')).toBe(true);
    expect(Object.keys(JSON.parse(text ?? '{}'))).toEqual([
      'schemaVersion',
      'region',
      'workload',
      'blocks',
      'edges',
      'scenarios',
    ]);
  });
  it('ordena as chaves dos records', () => {
    const a = {
      ...design,
      blocks: [{ ...design.blocks[0], attributes: { b: 1, a: 2 } }],
    } as DesignDocument;
    const b = {
      ...design,
      blocks: [{ ...design.blocks[0], attributes: { a: 2, b: 1 } }],
    } as DesignDocument;
    expect(serializeDesign(a)).toBe(serializeDesign(b));
  });
  it('recusa documento inválido', () => {
    expect(serializeDesign({ ...design, region: 'x' } as unknown as DesignDocument)).toBeNull();
  });
  it.each([...files('examples/design/valid'), ...files('scenarios')])(
    'ida e volta de %s devolve o mesmo documento',
    async (_n, text) => {
      const first = parseDesignFile(text);
      if (!first.ok) throw new Error('exemplo válido recusado');
      const out = serializeDesign(first.document);
      expect(out).not.toBeNull();
      const back = await readDesignFile(asFile(out ?? ''));
      // -0 e 0 são o mesmo número no JSON: comparar o texto canônico dos dois lados.
      expect(back.ok).toBe(true);
      expect(serializeDesign(back.ok ? back.document : design)).toBe(out);
    },
  );
});
