import type { ApiErrorDetail } from '../../../shared/lib/api';

/** Por que a estimativa não foi aplicada. Todo texto abaixo é próprio do app: nada vem do servidor. */
export type EstimateFailure =
  | { readonly kind: 'sign-in' }
  | { readonly kind: 'quota-user'; readonly resetsAt: string }
  | { readonly kind: 'quota-global'; readonly resetsAt: string }
  | { readonly kind: 'unavailable' | 'network' | 'too-large' | 'unusable' };

/** Só o `kind` (e, no 429, o escopo e a hora de volta) sai do erro; o resto é descartado. */
export function failureOf(detail: ApiErrorDetail): EstimateFailure {
  switch (detail.kind) {
    case 'unauthenticated':
      return { kind: 'sign-in' };
    case 'quota-exhausted':
      return {
        kind: detail.scope === 'user' ? 'quota-user' : 'quota-global',
        resetsAt: detail.resetsAt,
      };
    case 'unavailable':
    case 'network':
    case 'too-large':
      return { kind: detail.kind };
    default:
      return { kind: 'unusable' };
  }
}

/** "às 21:00" no fuso do navegador; vazio se a data não for válida. */
function backAt(resetsAt: string): string {
  const date = new Date(resetsAt);
  if (Number.isNaN(date.getTime())) return '';
  const time = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(
    date,
  );
  return ` às ${time}`;
}

export function failureMessage(failure: EstimateFailure): string {
  switch (failure.kind) {
    case 'sign-in':
      return 'Entre na sua conta para estimar a carga.';
    case 'quota-user':
      return `Você usou as estimativas de hoje. Elas voltam${backAt(failure.resetsAt) || ' amanhã'}. O diagrama não foi alterado.`;
    case 'quota-global':
      return 'O limite diário do serviço acabou; volta amanhã. O diagrama não foi alterado.';
    case 'unavailable':
      return 'O serviço de estimativa está indisponível. Tente mais tarde; o diagrama não foi alterado.';
    case 'network':
      return 'Sem conexão com o serviço de estimativa. Tente de novo; o diagrama não foi alterado.';
    case 'too-large':
      return 'O diagrama ou a descrição é grande demais para estimar. Reduza e tente de novo.';
    case 'unusable':
      return 'Não foi possível usar a resposta do serviço. O diagrama não foi alterado.';
  }
}
