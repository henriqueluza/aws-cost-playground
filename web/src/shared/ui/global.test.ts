import { describe, expect, it } from 'vitest';
import { readRepoFile } from '../../test/css';

describe('integração do estilo global', () => {
  it('global.css importa tokens antes de base', () => {
    const css = readRepoFile('web/src/shared/ui/global.css');
    const tokens = css.indexOf("'./tokens.css'");
    const base = css.indexOf("'./base.css'");
    expect(tokens).toBeGreaterThanOrEqual(0);
    expect(base).toBeGreaterThan(tokens);
  });

  it('main.tsx importa o global.css', () => {
    expect(readRepoFile('web/src/main.tsx')).toMatch(
      /import\s+['"]\.\/shared\/ui\/global\.css['"]/,
    );
  });
});
