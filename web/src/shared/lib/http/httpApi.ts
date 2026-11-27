import { z } from 'zod';
import {
  ApiError,
  MAX_DESIGNS,
  createDesignInputSchema,
  designIdSchema,
  designSchema,
  designSummarySchema,
  duplicateDesignInputSchema,
  estimateRequestSchema,
  estimateResponseSchema,
  quotaSchema,
  updateDesignInputSchema,
  type Api,
} from '../api';
import type { HttpTransport } from './transport';

/**
 * Adaptador HTTP das quatro portas (`Api`) sobre o transporte. As rotas são as do backend
 * (routers de `api/app/`). Toda entrada passa pelo schema antes de sair (só os campos do contrato
 * vão no corpo; nenhuma identidade é enviada: ela vem do JWT) e toda resposta sai do schema da
 * rota. Os erros são os `ApiError` do transporte, só com o `kind`.
 */

/** O limite de designs por conta (`MAX_DESIGNS`) é o teto da listagem aceita. */
const designListSchema = z.array(designSummarySchema).max(MAX_DESIGNS);
const noContent = z.void();

/** Entrada fora do contrato é `invalid-request`, sem chamar a API. */
function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new ApiError({ kind: 'invalid-request' });
  return result.data;
}

/** Só um ULID vira segmento de caminho; qualquer outro id não existe na conta. */
const isDesignId = (id: unknown): id is string => designIdSchema.safeParse(id).success;

function designPath(id: unknown, ...rest: string[]): string[] {
  if (!isDesignId(id)) throw new ApiError({ kind: 'not-found' });
  return ['designs', id, ...rest];
}

export function createHttpApi(transport: HttpTransport): Api {
  return {
    designs: {
      async list() {
        return transport.request({ method: 'GET', path: ['designs'] }, designListSchema);
      },

      async get(id) {
        return transport.request({ method: 'GET', path: designPath(id) }, designSchema);
      },

      async create(input) {
        const body = parseInput(createDesignInputSchema, input);
        return transport.request(
          { method: 'POST', path: ['designs'], body, conflict: 'design-limit' },
          designSchema,
        );
      },

      async update(id, input) {
        const body = parseInput(updateDesignInputSchema, input);
        return transport.request(
          { method: 'PATCH', path: designPath(id), body, conflict: 'version-conflict' },
          designSchema,
        );
      },

      async duplicate(id, input) {
        const body = parseInput(duplicateDesignInputSchema, input);
        return transport.request(
          {
            method: 'POST',
            path: designPath(id, 'duplicate'),
            body,
            conflict: 'design-limit',
          },
          designSchema,
        );
      },

      /** Idempotente como a porta pede: id que não é ULID não existe, então não há o que apagar. */
      async remove(id) {
        if (!isDesignId(id)) return;
        await transport.request({ method: 'DELETE', path: ['designs', id] }, noContent);
      },
    },

    estimates: {
      async estimateUsage(input) {
        const body = parseInput(estimateRequestSchema, input);
        return transport.request(
          { method: 'POST', path: ['estimates'], body },
          estimateResponseSchema,
        );
      },
    },

    quota: {
      async get() {
        return transport.request({ method: 'GET', path: ['quota'] }, quotaSchema);
      },
    },

    account: {
      async deleteAccount() {
        await transport.request({ method: 'DELETE', path: ['me'] }, noContent);
      },
    },
  };
}
