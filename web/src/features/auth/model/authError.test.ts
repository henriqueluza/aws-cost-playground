import { describe, expect, it } from 'vitest';
import { AuthError } from './authError';

describe('AuthError', () => {
  it('tem mensagem fixa, só o tipo, e nenhuma causa', () => {
    const error = new AuthError('state-mismatch');
    expect(error.message).toBe('Erro de autenticação: state-mismatch.');
    expect(error.cause).toBeUndefined();
    expect(error).toBeInstanceOf(Error);
  });
});
