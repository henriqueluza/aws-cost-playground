// @vitest-environment node
import { build, type Rollup } from 'vite';
import { describe, expect, it } from 'vitest';

const isOutput = (r: unknown): r is Rollup.RollupOutput =>
  !!r && !Array.isArray(r) && 'output' in (r as object);

describe('vite build', () => {
  it('emite os 10 woff2 e as licenças OFL, sem URI data:', async () => {
    const result = await build({ logLevel: 'silent', build: { write: false } });
    if (!isOutput(result)) throw new Error('saída inesperada do build');
    const names = result.output.map((o) => o.fileName);
    expect(names.filter((n) => /^assets\/ibm-plex-.*\.woff2$/.test(n))).toHaveLength(10);
    expect(names).toContain('fonts/OFL-ibm-plex-sans.txt');
    expect(names).toContain('fonts/OFL-ibm-plex-mono.txt');
    const licence = result.output.find((o) => o.fileName === 'fonts/OFL-ibm-plex-sans.txt');
    expect(licence && 'source' in licence && String(licence.source)).toMatch(
      /IBM Corp[\s\S]*SIL OPEN FONT LICENSE Version 1\.1/,
    );
  }, 60_000);
});
