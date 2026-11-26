import type { ApiErrorKind } from '../../../shared/lib/api';

/** Palavra que o usuário digita para liberar a exclusão. Comparação exata (sem espaço nas pontas). */
export const CONFIRM_WORD = 'EXCLUIR';

/** `true` só se o texto digitado é exatamente a palavra de confirmação (maiúsculas incluídas). */
export function confirmationMatches(typed: string): boolean {
  return typed.trim() === CONFIRM_WORD;
}

/** Frase própria por código; nunca o texto do erro nem o da resposta. */
export function deleteErrorMessage(kind: ApiErrorKind): string {
  switch (kind) {
    case 'unauthenticated':
      return 'Sua sessão expirou. Entre de novo para excluir a conta.';
    case 'network':
      return 'Sem conexão com o serviço. Sua conta não foi excluída. Confira a rede e tente de novo.';
    case 'unavailable':
      return 'O serviço está indisponível. A exclusão pode ter ficado pela metade; tente de novo, é seguro repetir.';
    case 'invalid-request':
      return 'O serviço não aceitou o pedido. Sua conta não foi excluída.';
    default:
      return 'Não conseguimos confirmar a exclusão. Tente de novo.';
  }
}

export function quotaErrorMessage(kind: ApiErrorKind): string {
  switch (kind) {
    case 'unauthenticated':
      return 'Sua sessão expirou. Entre de novo para ver sua conta.';
    case 'network':
      return 'Sem conexão com o serviço. Confira a rede e tente de novo.';
    case 'unavailable':
      return 'O serviço está indisponível no momento. Tente de novo.';
    default:
      return 'Não conseguimos ler suas estimativas. Tente de novo.';
  }
}

/** Vale oferecer "Tentar de novo": a falha é da rede ou do serviço, não do pedido nem da sessão. */
export function isRetryable(kind: ApiErrorKind): boolean {
  return kind !== 'unauthenticated' && kind !== 'invalid-request';
}
