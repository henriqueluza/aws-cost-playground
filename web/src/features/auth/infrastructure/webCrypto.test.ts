// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { constantTimeEqual, pkceChallenge, randomToken } from './webCrypto';

describe('randomToken', () => {
  it('gera base64url sem preenchimento: 32 bytes dão 43 caracteres, 64 bytes dão 86', () => {
    expect(randomToken(32)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken(64)).toMatch(/^[A-Za-z0-9_-]{86}$/);
  });

  it('não repete entre chamadas', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => randomToken(32)));
    expect(tokens.size).toBe(200);
  });
});

describe('pkceChallenge', () => {
  it('bate com o vetor do apêndice B da RFC 7636 (S256)', async () => {
    await expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).resolves.toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });
});

describe('constantTimeEqual', () => {
  it.each([
    ['abc', 'abc', true],
    ['abc', 'abd', false],
    ['abc', 'abcd', false],
    ['abcd', 'abc', false],
    ['', '', true],
    ['', 'a', false],
  ])('%j e %j: %s', (a, b, expected) => {
    expect(constantTimeEqual(a, b)).toBe(expected);
  });
});
