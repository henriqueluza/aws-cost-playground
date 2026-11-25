/** Qual dos dois contadores de quota estourou (ADR-0001, "Modelo de dados"). */
export type QuotaScope = 'user' | 'global';

/**
 * Motivo do erro. `quota-exhausted` (429) diz qual limite estourou e quando renova (ISO 8601 UTC);
 * `unavailable` cobre o 503 e o `LLM_ENABLED=false`; `too-large` é o 413.
 */
export type ApiErrorDetail =
  | {
      kind:
        | 'unauthenticated'
        | 'not-found'
        | 'version-conflict'
        | 'design-limit'
        | 'too-large'
        | 'unavailable'
        | 'invalid-request'
        | 'invalid-response'
        | 'network';
    }
  | { kind: 'quota-exhausted'; scope: QuotaScope; resetsAt: string };

export type ApiErrorKind = ApiErrorDetail['kind'];

/** Erro tipado das portas da API. A mensagem é fixa e não ecoa entrada nem resposta. */
export class ApiError extends Error {
  readonly detail: ApiErrorDetail;

  constructor(detail: ApiErrorDetail, options?: ErrorOptions) {
    super(`Erro da API: ${detail.kind}.`, options);
    this.name = 'ApiError';
    this.detail = detail;
  }

  get kind(): ApiErrorKind {
    return this.detail.kind;
  }
}

/**
 * `true` se `error` é um `ApiError` (de qualquer tipo, ou do `kind` pedido). Com `kind`, o
 * `detail` fica estreitado: depois de `isApiError(e, 'quota-exhausted')`, `e.detail.scope` existe.
 */
export function isApiError<K extends ApiErrorKind = ApiErrorKind>(
  error: unknown,
  kind?: K,
): error is ApiError & { readonly detail: ApiErrorDetail & { kind: K } } {
  return error instanceof ApiError && (kind === undefined || error.kind === kind);
}
