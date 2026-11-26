import { z } from 'zod';
import { type DesignDocument } from '../design';
import { ApiError, type ApiErrorKind, type QuotaScope } from './errors';
import {
  createDesignInputSchema,
  duplicateDesignInputSchema,
  estimateRequestSchema,
  estimateResponseSchema,
  type Api,
  type Design,
  type DesignSummary,
  type EstimateRequest,
  type EstimateResponse,
  type Quota,
  updateDesignInputSchema,
} from './ports';

/**
 * Fake em memória das quatro portas (`Api`), para testes e para o modo de desenvolvimento.
 * Cada chamada de `createInMemoryApi` é uma conta. Não é reexportado por `index.ts`, para não
 * entrar no bundle de produção.
 */
export type InMemoryApiOptions = {
  /** Estimativas por dia UTC desta conta. */
  userDailyLimit: number;
  /** Estimativas por dia UTC somadas; no fake, só esta instância soma. */
  globalDailyLimit: number;
  maxDesigns: number;
  /** Bytes UTF-8 de `JSON.stringify(doc)`; acima disso, `too-large`. */
  maxDocBytes: number;
  /** Padrão `true`. Com `false`, `estimateUsage` responde `unavailable` sem consumir quota. */
  llmEnabled?: boolean;
  /** Padrão `() => new Date()`. A janela da quota é o dia UTC de `now()`. */
  now?: () => Date;
  /** Padrão: contador a partir de 1 com `padStart(26, '0')`, que passa em `designIdSchema`. */
  newId?: () => string;
  /**
   * Padrão: `{ id, values: {} }` para cada bloco e aresta do pedido. O retorno passa por
   * `estimateResponseSchema`: só ids e números chegam a quem chama.
   */
  estimate?: (request: EstimateRequest) => Pick<EstimateResponse, 'blocks' | 'edges'>;
};

const encoder = new TextEncoder();
const DAY_MS = 24 * 60 * 60 * 1000;

function fail(kind: Exclude<ApiErrorKind, 'quota-exhausted'>): never {
  throw new ApiError({ kind });
}

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) fail('invalid-request');
  return result.data;
}

/** Campos que o servidor deriva do `doc` gravado. */
function derive(doc: DesignDocument) {
  return {
    region: doc.region,
    schemaVersion: doc.schemaVersion,
    blockCount: doc.blocks.length,
    sizeBytes: encoder.encode(JSON.stringify(doc)).length,
  };
}

function toSummary(design: Design): DesignSummary {
  return {
    id: design.id,
    name: design.name,
    region: design.region,
    schemaVersion: design.schemaVersion,
    blockCount: design.blockCount,
    sizeBytes: design.sizeBytes,
    createdAt: design.createdAt,
    updatedAt: design.updatedAt,
    version: design.version,
  };
}

/** Ordem decrescente por ponto de código; as datas vêm de `toISOString` e comparam como texto. */
function descending(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? 1 : -1;
}

function emptyEstimate(request: EstimateRequest): Pick<EstimateResponse, 'blocks' | 'edges'> {
  return {
    blocks: request.blocks.map(({ id }) => ({ id, values: {}, source: 'default' as const })),
    edges: request.edges.map(({ id }) => ({ id, values: {}, source: 'default' as const })),
  };
}

function sequentialIds(): () => string {
  let last = 0;
  return () => String(++last).padStart(26, '0');
}

export function createInMemoryApi(options: InMemoryApiOptions): Api {
  const { userDailyLimit, globalDailyLimit, maxDesigns, maxDocBytes } = options;
  const { llmEnabled = true, now = () => new Date(), newId = sequentialIds() } = options;
  const { estimate = emptyEstimate } = options;
  const store = new Map<string, Design>();
  const usage = { day: '', user: 0, global: 0 };

  /** Zera os dois contadores quando o dia UTC muda e devolve a próxima meia-noite UTC. */
  function openQuotaWindow(): string {
    const day = now().toISOString().slice(0, 10);
    if (day !== usage.day) Object.assign(usage, { day, user: 0, global: 0 });
    return new Date(Date.parse(`${day}T00:00:00.000Z`) + DAY_MS).toISOString();
  }

  function userQuota(resetsAt: string): Quota {
    return {
      limit: userDailyLimit,
      remaining: Math.max(0, userDailyLimit - usage.user),
      resetsAt,
    };
  }

  function exhausted(scope: QuotaScope, resetsAt: string): never {
    throw new ApiError({ kind: 'quota-exhausted', scope, resetsAt });
  }

  function find(id: string): Design {
    const design = store.get(id);
    if (design === undefined) fail('not-found');
    return design;
  }

  /** Guarda uma cópia e devolve outra: quem chama nunca segura uma referência ao estado. */
  function save(design: Design): Design {
    store.set(design.id, structuredClone(design));
    return structuredClone(design);
  }

  return {
    designs: {
      async list() {
        return [...store.values()]
          .map(toSummary)
          .sort((a, b) => descending(a.updatedAt, b.updatedAt) || descending(a.id, b.id));
      },

      async get(id) {
        return structuredClone(find(id));
      },

      async create(input) {
        const { name, doc } = parse(createDesignInputSchema, input);
        const derived = derive(doc);
        if (derived.sizeBytes > maxDocBytes) fail('too-large');
        if (store.size >= maxDesigns) fail('design-limit');
        const timestamp = now().toISOString();
        return save({
          id: newId(),
          name,
          ...derived,
          createdAt: timestamp,
          updatedAt: timestamp,
          version: 1,
          doc,
        });
      },

      async update(id, input) {
        const { expectedVersion, name, doc } = parse(updateDesignInputSchema, input);
        const current = find(id);
        if (expectedVersion !== current.version) fail('version-conflict');
        const nextDoc = doc ?? current.doc;
        const derived = derive(nextDoc);
        if (derived.sizeBytes > maxDocBytes) fail('too-large');
        return save({
          ...current,
          ...derived,
          name: name ?? current.name,
          updatedAt: now().toISOString(),
          version: current.version + 1,
          doc: nextDoc,
        });
      },

      async duplicate(id, input) {
        const { name } = parse(duplicateDesignInputSchema, input);
        const original = find(id);
        if (store.size >= maxDesigns) fail('design-limit');
        const timestamp = now().toISOString();
        return save({
          ...original,
          id: newId(),
          name,
          createdAt: timestamp,
          updatedAt: timestamp,
          version: 1,
        });
      },

      async remove(id) {
        store.delete(id);
      },
    },

    estimates: {
      async estimateUsage(input) {
        const request = parse(estimateRequestSchema, input);
        if (!llmEnabled) fail('unavailable');
        const resetsAt = openQuotaWindow();
        if (usage.user >= userDailyLimit) exhausted('user', resetsAt);
        if (usage.global >= globalDailyLimit) exhausted('global', resetsAt);
        const quota = { ...userQuota(resetsAt), remaining: userDailyLimit - usage.user - 1 };
        const response = estimateResponseSchema.safeParse({ ...estimate(request), quota });
        if (!response.success) fail('invalid-response');
        usage.user += 1;
        usage.global += 1;
        return response.data;
      },
    },

    quota: {
      async get() {
        return userQuota(openQuotaWindow());
      },
    },

    account: {
      /** O contador global não zera: no ADR ele é o item `GLOBAL`, não do usuário. */
      async deleteAccount() {
        store.clear();
        usage.user = 0;
      },
    },
  };
}
