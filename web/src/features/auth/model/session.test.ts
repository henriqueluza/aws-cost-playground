import { describe, expect, it } from 'vitest';
import { fakeSession, NOW } from '../../../test/authFixtures';
import { AuthError } from './authError';
import { EXPIRY_SKEW_MS, isFresh, sessionSchema } from './session';

describe('isFresh', () => {
  it('vale até um minuto antes do vencimento', () => {
    const session = fakeSession({ expiresAt: NOW + EXPIRY_SKEW_MS + 1 });
    expect(isFresh(session, NOW)).toBe(true);
    expect(isFresh(session, NOW + 1)).toBe(false);
    expect(isFresh(fakeSession({ expiresAt: NOW - 1 }), NOW)).toBe(false);
  });
});

describe('sessionSchema', () => {
  it('aceita a sessão válida, com refresh token nulo', () => {
    expect(sessionSchema.safeParse(fakeSession()).success).toBe(true);
    expect(sessionSchema.safeParse(fakeSession({ refreshToken: null })).success).toBe(true);
  });

  it.each([
    ['campo a mais', { ...fakeSession(), idToken: 'x.y.z' }],
    ['token com espaço', fakeSession({ accessToken: 'a b' })],
    ['token com quebra de linha', fakeSession({ accessToken: 'a\nb' })],
    ['token vazio', fakeSession({ accessToken: '' })],
    ['vencimento negativo', fakeSession({ expiresAt: -1 })],
    ['sub com caractere inválido', fakeSession({ user: { sub: '../x', email: null } })],
    ['e-mail inválido', fakeSession({ user: { sub: 'a', email: 'não é e-mail' } })],
  ])('recusa %s', (_name, value) => {
    expect(sessionSchema.safeParse(value).success).toBe(false);
  });
});

describe('AuthError', () => {
  it('tem mensagem fixa, só o tipo, e nenhuma causa', () => {
    const error = new AuthError('state-mismatch');
    expect(error.message).toBe('Erro de autenticação: state-mismatch.');
    expect(error.cause).toBeUndefined();
    expect(error).toBeInstanceOf(Error);
  });
});
