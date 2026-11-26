import type { ApiErrorKind } from '../../../shared/lib/api';

/** Palavra que o usuário digita para liberar a exclusão. Comparação exata (sem espaço nas pontas). */
export const CONFIRM_WORD = 'EXCLUIR';

/** `true` só se o texto digitado é exatamente a palavra de confirmação (maiúsculas incluídas). */
export function confirmationMatches(typed: string): boolean {
  return typed.trim() === CONFIRM_WORD;
}

/** Frase própria por código, para a exclusão e a leitura da quota; nunca o texto do erro. */
export function accountErrorMessage(kind: ApiErrorKind): string {
  switch (kind) {
    case 'unauthenticated':
      return 'Sua sessão expirou. Entre de novo para continuar.';
    case 'network':
      return 'Sem conexão com o serviço. Nada foi alterado na sua conta. Confira a rede e tente de novo.';
    case 'unavailable':
      return 'O serviço está indisponível agora. Tente de novo em instantes; repetir é seguro.';
    case 'invalid-request':
      return 'O serviço não aceitou o pedido. Nada foi alterado na sua conta.';
    default:
      return 'Não conseguimos concluir o pedido. Tente de novo.';
  }
}

/** Vale oferecer "Tentar de novo": a falha é da rede ou do serviço, não do pedido nem da sessão. */
export function isRetryable(kind: ApiErrorKind): boolean {
  return kind !== 'unauthenticated' && kind !== 'invalid-request';
}
