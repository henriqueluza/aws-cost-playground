import { describe, expect, it } from 'vitest';
import { safeReturnTo } from './returnTo';

describe('safeReturnTo', () => {
  it.each(['/', '/designs', '/comparar?a=1&b=2', '/conta#topo', '/designs/%C3%A1'])(
    'aceita o caminho interno %s',
    (path) => {
      expect(safeReturnTo(path)).toBe(path);
    },
  );

  it.each([
    ['URL absoluta', 'https://evil.example/'],
    ['esquema relativo', '//evil.example/x'],
    ['barra invertida', '/\\evil.example'],
    ['barra e barra invertida', '/\\/evil.example'],
    ['esquema perigoso', 'javascript:alert(1)'],
    ['sem barra inicial', 'designs'],
    ['quebra de linha', '/ok\n//evil.example'],
    ['tabulação', '/\t/evil.example'],
    ['volta ao callback', '/auth/callback?code=1'],
    ['callback codificado', '/%61uth/callback'],
    ['caminho de auth', '/auth'],
    ['codificação inválida', '/%E0%A4%A'],
    ['longo demais', `/${'a'.repeat(512)}`],
    ['não é string', 42],
    ['nulo', null],
  ])('recusa %s e cai em `/`', (_name, raw) => {
    expect(safeReturnTo(raw)).toBe('/');
  });

  it('normaliza segmentos de ponto sem sair do site', () => {
    expect(safeReturnTo('/designs/../conta')).toBe('/conta');
    expect(safeReturnTo('/../../..//evil.example')).toBe('/');
  });
});
