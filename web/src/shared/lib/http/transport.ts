import { z } from 'zod';
import { runtimeConfigSchema } from '../../config';
import { ApiError, type ApiErrorKind } from '../api';

/**
 * Transporte HTTP das portas da API: uma requisição autenticada, com tempo limite, resposta
 * limitada em tamanho e validada por schema. Não guarda o token, não escreve em `console` e
 * nunca repassa texto do servidor: todo erro sai como `ApiError`, só com o `kind`.
 */

/** O `doc` tem até 350 KB (ADR-0001); o resto do corpo de um design cabe na folga. */
export const MAX_RESPONSE_BYTES = 512 * 1024;
export const DEFAULT_TIMEOUT_MS = 30_000;

type SimpleKind = Exclude<ApiErrorKind, 'quota-exhausted'>;

export type HttpTransportOptions = {
  /** `apiBaseUrl` do `/config.json`. Nunca vem de entrada do usuário. */
  baseUrl: string;
  /** Token de acesso atual, ou `null` sem sessão. É chamado a cada requisição. */
  getAccessToken: () => Promise<string | null> | string | null;
  timeoutMs?: number;
};

export type HttpRequest = {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** Segmentos do caminho; cada um passa por `encodeURIComponent`. */
  path: readonly string[];
  body?: unknown;
  /** O que o 409 significa nesta rota. Padrão: `version-conflict`. */
  conflict?: 'version-conflict' | 'design-limit';
};

export type HttpTransport = {
  /** Resposta sem corpo vira `undefined` antes do schema: use `z.void()` nessas rotas. */
  request<T>(request: HttpRequest, schema: z.ZodType<T>): Promise<T>;
};

const STATUS_KINDS: Readonly<Record<number, SimpleKind>> = {
  400: 'invalid-request',
  401: 'unauthenticated',
  403: 'unauthenticated',
  404: 'not-found',
  413: 'too-large',
  422: 'invalid-request',
};

/** Campos de extensão do problem details do 429 de quota (RFC 9457). */
const quotaProblemSchema = z.object({
  scope: z.enum(['user', 'global']),
  resetsAt: z.iso.datetime(),
});

/** Caracteres de um JWT. Barra espaço e quebra de linha no cabeçalho. */
const TOKEN_PATTERN = /^[\w.~+/=-]+$/;

function fail(kind: SimpleKind): never {
  throw new ApiError({ kind });
}

/** Lê o corpo até `MAX_RESPONSE_BYTES`; acima disso cancela a leitura. */
async function readText(response: Response): Promise<string> {
  if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) fail('invalid-response');
  const reader = response.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let text = '';
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      fail('invalid-response');
    }
    text += decoder.decode(value, { stream: true });
  }
}

/** JSON do corpo, ou `undefined` se vazio. Só aceita `application/json` e `+json`. */
async function readJson(response: Response): Promise<unknown> {
  const text = await readText(response);
  if (text === '') return undefined;
  if (!/^application\/([\w.-]+\+)?json\b/i.test(response.headers.get('content-type') ?? '')) {
    fail('invalid-response');
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return fail('invalid-response');
  }
}

/** O erro sai só do status (e, no 429, de dois campos validados): `title` e `detail` são ignorados. */
async function toApiError(response: Response, request: HttpRequest): Promise<ApiError> {
  const { status } = response;
  if (status === 429) {
    const quota = quotaProblemSchema.safeParse(await readJson(response).catch(() => undefined));
    // 429 sem os campos de quota é o limite de taxa do API Gateway.
    return new ApiError(
      quota.success ? { kind: 'quota-exhausted', ...quota.data } : { kind: 'unavailable' },
    );
  }
  void response.body?.cancel();
  if (status === 409) return new ApiError({ kind: request.conflict ?? 'version-conflict' });
  if (status >= 500) return new ApiError({ kind: 'unavailable' });
  return new ApiError({ kind: STATUS_KINDS[status] ?? 'invalid-response' });
}

export function createHttpTransport(options: HttpTransportOptions): HttpTransport {
  // Falha fechada: URL fora do schema da configuração não cria o transporte.
  const base = new URL(runtimeConfigSchema.shape.apiBaseUrl.parse(options.baseUrl));
  if (base.username || base.password || base.search || base.hash) {
    throw new Error('A URL da API é inválida.');
  }
  const prefix = base.origin + base.pathname.replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  function buildUrl(path: readonly string[]): string {
    if (path.length === 0 || path.some((segment) => /^\.{0,2}$/.test(segment))) {
      fail('invalid-request');
    }
    const url = new URL(`${prefix}/${path.map(encodeURIComponent).join('/')}`);
    if (url.origin !== base.origin) fail('invalid-request');
    return url.href;
  }

  async function request<T>(req: HttpRequest, schema: z.ZodType<T>): Promise<T> {
    const url = buildUrl(req.path);
    const token = await Promise.resolve()
      .then(options.getAccessToken)
      .catch(() => null);
    if (!token || !TOKEN_PATTERN.test(token)) fail('unauthenticated');

    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    };
    if (req.body !== undefined) headers['Content-Type'] = 'application/json';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: req.method,
        headers,
        body: req.body === undefined ? undefined : JSON.stringify(req.body),
        signal: controller.signal,
        // Sem cookies, sem seguir redirecionamento (o token não vai a outra origem), sem cache.
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
      });
      if (!response.ok) throw await toApiError(response, req);
      const parsed = schema.safeParse(await readJson(response));
      if (!parsed.success) fail('invalid-response');
      return parsed.data;
    } catch (error) {
      // Sem `cause`: o erro original pode trazer URL ou corpo.
      if (error instanceof ApiError) throw error;
      return fail('network');
    } finally {
      clearTimeout(timer);
    }
  }

  return { request };
}
