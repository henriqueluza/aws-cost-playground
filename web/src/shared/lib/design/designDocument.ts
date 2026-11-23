import { z } from 'zod';

/** Regiões aceitas no MVP (PRD F6). */
export const REGIONS = ['us-east-1', 'sa-east-1'] as const;
/** `data`: tráfego cobrado; `runs-on`: ECS sobre EC2; `logs`: bloco para o CloudWatch. */
export const EDGE_KINDS = ['data', 'runs-on', 'logs'] as const;
/** Origem do `usage`. O valor alterado à mão não é origem: ele mora em `overrides`. */
export const USAGE_SOURCES = ['llm', 'default'] as const;
/** Nó fixo, sem preço, que representa a internet. É o destino das arestas de egress. */
export const CLIENT_NODE_ID = 'client';

/** Limites do documento. `maxBlocks` e `maxDescriptionLength` vêm do ADR-0001; os outros, do PR #8. */
export const DESIGN_LIMITS = {
  maxBlocks: 100,
  maxEdges: 400,
  maxDescriptionLength: 2000,
  maxLabelLength: 80,
} as const;

/** Chave de atributo e de uso em camelCase. O zod 4 já descarta `__proto__` dos records. */
const fieldKey = z.string().regex(/^[a-z][A-Za-z0-9]{0,39}$/);
const blockId = z.string().regex(/^blk_[A-Za-z0-9_-]{1,60}$/);
const edgeId = z.string().regex(/^edg_[A-Za-z0-9_-]{1,60}$/);

/** Números de uso: finitos e não negativos. Também é o formato de `overrides`. */
export const usageValuesSchema = z.record(fieldKey, z.number().min(0));

export const usageSchema = z.object({
  source: z.enum(USAGE_SOURCES),
  estimatedAt: z.iso.datetime().optional(),
  values: usageValuesSchema,
});

export const blockSchema = z.object({
  id: blockId,
  /** Genérico de propósito: os tipos aceitos são definidos em `features/pricing/model`. */
  type: z.string().regex(/^aws\.[a-z0-9-]{1,40}$/),
  label: z.string().max(DESIGN_LIMITS.maxLabelLength),
  attributes: z.record(fieldKey, z.union([z.string().max(64), z.number(), z.boolean()])),
  usage: usageSchema,
  overrides: usageValuesSchema,
});

export const edgeSchema = z.object({
  id: edgeId,
  source: blockId,
  target: z.union([blockId, z.literal(CLIENT_NODE_ID)]),
  kind: z.enum(EDGE_KINDS),
  usage: usageSchema,
  overrides: usageValuesSchema,
});

/**
 * Documento do design (ADR-0001, "Modelo de dados"): o JSON que o anônimo baixa e o logado salva.
 * Leitura tolerante: chave desconhecida é descartada, não recusada, para que um build anterior
 * ainda abra o arquivo salvo por um build novo (rollback).
 */
export const designDocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    region: z.enum(REGIONS),
    workload: z.object({ description: z.string().max(DESIGN_LIMITS.maxDescriptionLength) }),
    blocks: z.array(blockSchema).max(DESIGN_LIMITS.maxBlocks),
    edges: z.array(edgeSchema).max(DESIGN_LIMITS.maxEdges),
    scenarios: z.tuple([]),
  })
  .superRefine((doc, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: 'custom', path, message });

    const blockIds = new Set<string>();
    doc.blocks.forEach((block, i) => {
      if (blockIds.has(block.id)) issue(['blocks', i, 'id'], 'Id de bloco repetido.');
      blockIds.add(block.id);
    });

    const edgeIds = new Set<string>();
    doc.edges.forEach((edge, i) => {
      if (edgeIds.has(edge.id)) issue(['edges', i, 'id'], 'Id de aresta repetido.');
      edgeIds.add(edge.id);
      if (!blockIds.has(edge.source)) {
        issue(['edges', i, 'source'], 'A aresta parte de um bloco que não existe.');
      }
      if (edge.target !== CLIENT_NODE_ID && !blockIds.has(edge.target)) {
        issue(['edges', i, 'target'], 'A aresta chega a um bloco que não existe.');
      }
    });
  });

export type Region = (typeof REGIONS)[number];
export type EdgeKind = (typeof EDGE_KINDS)[number];
export type UsageSource = (typeof USAGE_SOURCES)[number];
export type UsageValues = z.infer<typeof usageValuesSchema>;
export type Overrides = UsageValues;
export type Usage = z.infer<typeof usageSchema>;
export type Block = z.infer<typeof blockSchema>;
export type Edge = z.infer<typeof edgeSchema>;
export type DesignDocument = z.infer<typeof designDocumentSchema>;
