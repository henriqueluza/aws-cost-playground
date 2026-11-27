/**
 * Motivo da falha de autenticação.
 * - `state-mismatch`: o `state` do retorno não é o de um pedido desta aba (ou já foi usado).
 * - `callback-invalid`: o retorno veio sem `code` ou sem `state`.
 * - `provider-denied`: o provedor devolveu `error` no retorno.
 * - `session-expired`: o refresh token não vale mais; é preciso entrar de novo.
 * - `invalid-response`: tokens ou claims fora do esperado.
 * - `login-origin`: o login anunciado pela descoberta não é o login gerenciado deste site.
 * - `network`: o provedor não respondeu; tentar de novo pode resolver.
 */
export type AuthErrorKind =
  | 'state-mismatch'
  | 'callback-invalid'
  | 'provider-denied'
  | 'session-expired'
  | 'invalid-response'
  | 'login-origin'
  | 'network';

/**
 * Erro tipado da autenticação. A mensagem é fixa e não há `cause`: nada de URL de retorno,
 * `error_description` do provedor ou token chega a quem captura ou registra o erro.
 */
export class AuthError extends Error {
  readonly kind: AuthErrorKind;

  constructor(kind: AuthErrorKind) {
    super(`Erro de autenticação: ${kind}.`);
    this.name = 'AuthError';
    this.kind = kind;
  }
}
