// @vitest-environment node
import { build, type Rollup } from 'vite';
import { afterEach, describe, expect, it, vi } from 'vitest';

type Chunk = Extract<Rollup.RollupOutput['output'][number], { type: 'chunk' }>;

/** Trecho do fake (`sequentialIds`) que sobrevive à minificação; o nome do módulo cobre o resto. */
const FAKE_CODE = /padStart\(26,\s*["'`]0["'`]\)/;

async function fakeInBundle(nodeEnv: 'production' | 'development') {
  // O `import.meta.env.DEV` do build segue o NODE_ENV; o Vitest roda com `test`.
  vi.stubEnv('NODE_ENV', nodeEnv);
  const result = await build({ logLevel: 'silent', build: { write: false } });
  if (Array.isArray(result) || !('output' in result)) throw new Error('saída inesperada do build');
  const chunks = result.output.filter((o): o is Chunk => o.type === 'chunk');
  return {
    byName: chunks.some(
      (c) => /inMemoryApi/.test(c.fileName) || c.moduleIds.some((id) => /inMemoryApi/.test(id)),
    ),
    byCode: chunks.some((c) => FAKE_CODE.test(c.code)),
    http: chunks.some((c) => c.moduleIds.some((id) => /shared\/lib\/http\/httpApi\.ts$/.test(id))),
  };
}

describe('fake da API no bundle', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('o build de produção não leva o fake em memória, só o cliente HTTP', async () => {
    expect(await fakeInBundle('production')).toEqual({ byName: false, byCode: false, http: true });
  }, 60_000);

  it('controle: o build de desenvolvimento leva o fake, e a checagem o encontra', async () => {
    expect(await fakeInBundle('development')).toMatchObject({ byName: true, byCode: true });
  }, 60_000);
});
