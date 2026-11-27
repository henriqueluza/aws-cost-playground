import { MAX_DESIGNS, type ApiErrorKind } from '../../../shared/lib/api';

export const DESIGN_LIMIT = MAX_DESIGNS;

const MESSAGES: Record<ApiErrorKind, string> = {
  unauthenticated: 'Entre na sua conta para salvar e abrir designs.',
  'design-limit': `Você atingiu o limite de ${DESIGN_LIMIT} designs.`,
  'too-large': 'Este design é grande demais para salvar. Remova alguns blocos e tente de novo.',
  'version-conflict':
    'Este design foi alterado em outro lugar. Nada foi sobrescrito: recarregue a versão salva ou salve o seu como cópia.',
  'not-found': 'Este design não existe mais na sua conta.',
  'invalid-request': 'O serviço não aceitou este design. Seu design atual não foi alterado.',
  'invalid-response': 'O serviço devolveu um design que não conseguimos abrir.',
  'quota-exhausted': 'Não conseguimos falar com o serviço agora. Tente de novo.',
  unavailable: 'O serviço está indisponível no momento. Tente de novo.',
  network: 'Sem conexão com o serviço. Confira a rede e tente de novo.',
};

/** Frase própria por código de erro; nunca o texto do erro nem o da resposta. */
export function designErrorMessage(kind: ApiErrorKind): string {
  return MESSAGES[kind];
}

/** Vale oferecer "Tentar de novo": a falha é do serviço ou da rede, não do pedido. */
export function isRetryable(kind: ApiErrorKind): boolean {
  return kind === 'network' || kind === 'unavailable' || kind === 'quota-exhausted';
}

/** Nome da cópia: sufixo " (cópia)", cortado para caber nos 80 caracteres do nome. */
export function copyName(name: string): string {
  const suffix = ' (cópia)';
  return name.slice(0, 80 - suffix.length).trimEnd() + suffix;
}
