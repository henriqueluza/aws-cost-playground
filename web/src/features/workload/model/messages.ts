import type { ApiErrorDetail, Quota } from '../../../shared/lib/api';

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

/** "Restam 12 de 20 hoje". */
export function quotaLine(quota: Pick<Quota, 'limit' | 'remaining'>): string {
  return `Restam ${quota.remaining} de ${quota.limit} hoje`;
}

export function appliedMessage(blocks: number, edges: number): string {
  if (blocks + edges === 0)
    return 'A estimativa não trouxe valores utilizáveis; nada foi alterado.';
  const part = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  return `Estimativa aplicada: ${part(blocks, 'bloco', 'blocos')} e ${part(edges, 'conexão', 'conexões')}.`;
}

/** Marcos do contador: a região `aria-live` só muda ao cruzar um, não a cada tecla. */
const MILESTONES = [
  { at: 1800, text: 'Restam 200 caracteres.' },
  { at: 1900, text: 'Restam 100 caracteres.' },
  { at: 2000, text: 'Limite de 2.000 caracteres atingido.' },
] as const;

export function counterAnnouncement(length: number): string {
  return MILESTONES.findLast((m) => length >= m.at)?.text ?? '';
}

export const SIGN_IN_ERROR = 'Não foi possível abrir o login. Tente de novo.';

/** Quando e por que o botão não estima; `null` se pode. A mesma frase vai na tela, não só no tooltip. */
export type Blocker = { blocks: number; description: string; locked: EstimateFailure | null };

export function blockedReason({ blocks, description, locked }: Blocker): string | null {
  if (blocks === 0) return 'Adicione blocos ao diagrama para estimar a carga.';
  if (description.trim() === '') return 'Descreva a carga para estimar.';
  return locked ? failureMessage(locked) : null;
}

/** Quota esgotada (do usuário ou global) enquanto a hora de volta não passou. */
export function lockOf(
  failure: EstimateFailure | null,
  quota: Pick<Quota, 'remaining' | 'resetsAt'> | null,
  now: number,
): EstimateFailure | null {
  const open = (resetsAt: string) => !(new Date(resetsAt).getTime() <= now);
  if (failure && (failure.kind === 'quota-user' || failure.kind === 'quota-global')) {
    return open(failure.resetsAt) ? failure : null;
  }
  if (quota && quota.remaining === 0 && open(quota.resetsAt)) {
    return { kind: 'quota-user', resetsAt: quota.resetsAt };
  }
  return null;
}
