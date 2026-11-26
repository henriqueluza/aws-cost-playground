import { AuthError, type AuthErrorKind } from './authError';

/**
 * Frase para o usuário, por categoria. Texto fixo nosso: nada do servidor de autorização
 * (`error_description`, trecho da resposta) chega à interface.
 */
const MESSAGES: Record<AuthErrorKind, string> = {
  'provider-denied': 'O login não foi concluído. Tente de novo.',
  'state-mismatch': 'Este retorno do login não é válido ou já foi usado. Entre de novo.',
  'callback-invalid': 'Este retorno do login não é válido ou já foi usado. Entre de novo.',
  'session-expired': 'Sua sessão terminou. Entre de novo.',
  'invalid-response': 'O serviço de login respondeu de um jeito inesperado. Tente de novo.',
  network: 'O serviço de login não respondeu. Verifique a conexão e tente de novo.',
};

/** Categoria do erro; o que não é `AuthError` conta como resposta inesperada. */
export function authErrorKind(error: unknown): AuthErrorKind {
  return error instanceof AuthError ? error.kind : 'invalid-response';
}

export const authMessage = (kind: AuthErrorKind): string => MESSAGES[kind];
