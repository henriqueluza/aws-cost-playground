import { z } from 'zod';
import { designDocumentSchema, type DesignDocument } from '../design';
import { ApiError, type ApiErrorKind } from './errors';
import {
  designNameSchema,
  type AccountApi,
  type Design,
  type DesignSummary,
  type DesignsApi,
} from './ports';

/**
 * Fake em memória de `DesignsApi` e `AccountApi`, para testes e para o modo de desenvolvimento.
 * Não é reexportado por `index.ts`, para não entrar no bundle de produção.
 */
export type InMemoryApiOptions = {
  maxDesigns: number;
  /** Bytes UTF-8 de `JSON.stringify(doc)`; acima disso, `too-large`. */
  maxDocBytes: number;
  /** Padrão `() => new Date()`. */
  now?: () => Date;
  /** Padrão: contador a partir de 1 com `padStart(26, '0')`, que passa em `designIdSchema`. */
  newId?: () => string;
};

/** A entrada chega como `unknown` em runtime: os tipos das portas não validam nada. */
const createInputSchema = z.object({ name: designNameSchema, doc: designDocumentSchema });

const encoder = new TextEncoder();

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

function sequentialIds(): () => string {
  let last = 0;
  return () => String(++last).padStart(26, '0');
}

/** A continuação da #151 acrescenta `update` e `duplicate` e alarga `designs` para `DesignsApi`. */
export type InMemoryApi = {
  designs: Pick<DesignsApi, 'list' | 'get' | 'create' | 'remove'>;
  account: AccountApi;
};

export function createInMemoryApi(options: InMemoryApiOptions): InMemoryApi {
  const { maxDesigns, maxDocBytes, now = () => new Date(), newId = sequentialIds() } = options;
  const store = new Map<string, Design>();

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
        const { name, doc } = parse(createInputSchema, input);
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

      async remove(id) {
        store.delete(id);
      },
    },

    account: {
      async deleteAccount() {
        store.clear();
      },
    },
  };
}
