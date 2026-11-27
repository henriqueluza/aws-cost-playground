import { z } from 'zod';
import {
  DESIGN_LIMITS,
  USAGE_SOURCES,
  blockSchema,
  designDocumentSchema,
  edgeSchema,
  usageValuesSchema,
  type DesignDocument,
} from '../design';

/**
 * Contratos das portas da API (ADR-0001, "Modelo de dados" e "Fluxo da estimativa de carga").
 * Nenhuma assinatura recebe `userId`/`sub`: a identidade vem só do JWT, no servidor.
 * Os schemas de resposta são `z.object` (leitura tolerante): chave desconhecida é descartada.
 */

/** Id do design: ULID gerado no servidor (26 caracteres do base32 de Crockford). */
export const designIdSchema = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/);
/** Nome do design: 1 a 80 caracteres sem espaço nas pontas. */
export const designNameSchema = z.string().trim().min(1).max(DESIGN_LIMITS.maxLabelLength);

/** Item da listagem: a projeção do ADR, sem `doc`. */
export const designSummarySchema = z.object({
  id: designIdSchema,
  name: designNameSchema,
  region: designDocumentSchema.shape.region,
  schemaVersion: z.number().int().min(1),
  blockCount: z.number().int().min(0),
  sizeBytes: z.number().int().min(0),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  /** Trava otimista: o `update` manda a versão lida; a gravação a incrementa. */
  version: z.number().int().min(1),
});

/** Design completo, com o documento. */
export const designSchema = designSummarySchema.extend({ doc: designDocumentSchema });

/** Quota de estimativas do usuário, calculada no servidor. `resetsAt` é ISO 8601 UTC. */
export const quotaSchema = z.object({
  limit: z.number().int().min(0),
  remaining: z.number().int().min(0),
  resetsAt: z.iso.datetime(),
});

/** Entrada da estimativa: o diagrama sem `label`, `usage` e `overrides`, mais a descrição. */
export const estimateRequestSchema = z.object({
  region: designDocumentSchema.shape.region,
  description: designDocumentSchema.shape.workload.shape.description,
  blocks: z
    .array(blockSchema.omit({ label: true, usage: true, overrides: true }))
    .max(DESIGN_LIMITS.maxBlocks),
  edges: z.array(edgeSchema.omit({ usage: true, overrides: true })).max(DESIGN_LIMITS.maxEdges),
});

/**
 * Saída da estimativa: só ids, números e a origem (`source`, enum calculado na API: `default`
 * quando nenhum valor veio da LLM para o item), mais a quota restante. Sem `source`: `invalid-response`.
 */
const estimatedItem = { values: usageValuesSchema, source: z.enum(USAGE_SOURCES) };
export const estimateResponseSchema = z.object({
  blocks: z
    .array(z.object({ id: blockSchema.shape.id, ...estimatedItem }))
    .max(DESIGN_LIMITS.maxBlocks),
  edges: z
    .array(z.object({ id: edgeSchema.shape.id, ...estimatedItem }))
    .max(DESIGN_LIMITS.maxEdges),
  quota: quotaSchema,
});

export type DesignSummary = z.infer<typeof designSummarySchema>;
export type Design = z.infer<typeof designSchema>;
export type Quota = z.infer<typeof quotaSchema>;
export type EstimateRequest = z.infer<typeof estimateRequestSchema>;
export type EstimateResponse = z.infer<typeof estimateResponseSchema>;

/**
 * Schemas de entrada das portas de designs. A entrada chega como `unknown` em runtime (os tipos
 * não validam nada): o fake e o adaptador HTTP validam com eles antes de gravar ou de enviar.
 */
export const createDesignInputSchema = z.object({
  name: designNameSchema,
  doc: designDocumentSchema,
});
/** Teto de `expectedVersion`, o mesmo de `MAX_VERSION` na API: o maior inteiro exato do JS. */
export const MAX_DESIGN_VERSION = Number.MAX_SAFE_INTEGER;
export const updateDesignInputSchema = z
  .object({
    expectedVersion: z.number().int().min(1).max(MAX_DESIGN_VERSION),
    name: designNameSchema.optional(),
    doc: designDocumentSchema.optional(),
  })
  .refine((input) => input.name !== undefined || input.doc !== undefined);
export const duplicateDesignInputSchema = z.object({ name: designNameSchema });

export type CreateDesignInput = { name: string; doc: DesignDocument };
/** Ao menos um de `name` e `doc`: renomear é um `update` só com `name`. */
export type UpdateDesignInput = { expectedVersion: number } & (
  { name: string; doc?: DesignDocument } | { name?: string; doc: DesignDocument }
);
export type DuplicateDesignInput = { name: string };

/** Erros: `ApiError` com `kind` (veja `errors.ts`). */
export interface DesignsApi {
  /** Metadados dos designs do usuário, do mais recente para o mais antigo (`updatedAt`). */
  list(): Promise<DesignSummary[]>;
  /** `not-found` se o design não existe na conta. */
  get(id: string): Promise<Design>;
  /** `design-limit` no limite de designs; `too-large` acima do tamanho do `doc`. */
  create(input: CreateDesignInput): Promise<Design>;
  /** `version-conflict` se `expectedVersion` não é a atual; nada é gravado. */
  update(id: string, input: UpdateDesignInput): Promise<Design>;
  /** Cópia com outro nome; respeita o limite de designs. */
  duplicate(id: string, input: DuplicateDesignInput): Promise<Design>;
  /** Idempotente: apagar um design que não existe não é erro. */
  remove(id: string): Promise<void>;
}

export interface EstimatesApi {
  /** Consome quota. `quota-exhausted` (429) e `unavailable` (503 / LLM desligada). */
  estimateUsage(request: EstimateRequest): Promise<EstimateResponse>;
}

export interface QuotaApi {
  /** Lê a quota sem consumir. */
  get(): Promise<Quota>;
}

export interface AccountApi {
  /** Apaga os designs e a quota do usuário. */
  deleteAccount(): Promise<void>;
}

/** As quatro portas juntas, como o composition root as entrega. */
export interface Api {
  designs: DesignsApi;
  estimates: EstimatesApi;
  quota: QuotaApi;
  account: AccountApi;
}
