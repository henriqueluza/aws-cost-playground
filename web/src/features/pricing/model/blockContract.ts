import { z } from 'zod';
import {
  CLIENT_NODE_ID,
  DESIGN_LIMITS,
  EDGE_KINDS,
  type Block,
  type UsageValues,
} from '../../../shared/lib/design';
import type { Decimal } from '../../../shared/lib/money';
import type { ChargeKind } from './engine';

/** Os 20 blocos do PRD (F2) e o nível de preço de cada um (F10 a F12). `C` é custo zero. */
export const PRD_BLOCK_LEVELS = {
  'aws.ec2': 'A',
  'aws.lambda': 'A',
  'aws.rds': 'A',
  'aws.dynamodb': 'A',
  'aws.elasticache': 'A',
  'aws.s3': 'A',
  'aws.sqs': 'A',
  'aws.cloudfront': 'A',
  'aws.alb': 'A',
  'aws.cloudwatch': 'A',
  'aws.nat-gateway': 'A',
  'aws.waf': 'B',
  'aws.cognito': 'B',
  'aws.secrets-manager': 'B',
  'aws.cloudtrail': 'B',
  'aws.route53': 'B',
  'aws.codepipeline': 'B',
  'aws.iam': 'C',
  'aws.cloudformation': 'C',
  'aws.ecs': 'C',
} as const;

export type BlockType = keyof typeof PRD_BLOCK_LEVELS;
export type BlockLevel = (typeof PRD_BLOCK_LEVELS)[BlockType];
export const BLOCK_TYPES = Object.keys(PRD_BLOCK_LEVELS) as [BlockType, ...BlockType[]];
/** Grupos da paleta, com os nomes das categorias da própria AWS. */
export const BLOCK_CATEGORIES = [
  'compute',
  'storage',
  'database',
  'networking',
  'integration',
  'security',
  'management',
  'devtools',
] as const;

/** Limites dos arquivos de `contracts/`, lidos como entrada não confiável. */
export const BLOCK_CONTRACT_LIMITS = {
  maxOptions: 32,
  maxNameLength: 40,
  maxUnitLength: 40,
} as const;

/** Mesma chave camelCase do documento do design (`attributes`, `usage.values`, `overrides`). */
const fieldKey = z
  .string()
  .regex(/^[a-z][A-Za-z0-9]{0,39}$/)
  .refine((key) => !Object.hasOwn(Object.prototype, key));
const usageNumber = z.number().min(0).max(DESIGN_LIMITS.maxUsageValue);
const optionValue = z.union([z.string().min(1).max(64), z.number()]);
const hasUniqueKeys = (fields: readonly { key: string }[]) =>
  new Set(fields.map((field) => field.key)).size === fields.length;
const fieldList = <T extends z.ZodType<{ key: string }>>(field: T) =>
  z.array(field).max(DESIGN_LIMITS.maxFieldsPerRecord).refine(hasUniqueKeys, 'Chave repetida.');

/** Atributo do SKU: conjunto fechado de opções. Sem `default`, o atributo é opcional (ex.: `az`). */
const attributeSchema = z
  .object({
    key: fieldKey,
    options: z.array(optionValue).min(1).max(BLOCK_CONTRACT_LIMITS.maxOptions),
    default: optionValue.optional(),
  })
  .refine((a) => new Set(a.options).size === a.options.length, 'Opção repetida.')
  .refine((a) => new Set(a.options.map((o) => typeof o)).size === 1, 'Opções de tipos diferentes.')
  .refine((a) => a.default === undefined || a.options.includes(a.default), {
    path: ['default'],
    message: 'O padrão não está entre as opções.',
  });

/** Chave de uso: número com unidade, padrão e faixa plausível. `integer` recusa fração. */
const usageKeySchema = z
  .object({
    key: fieldKey,
    unit: z.string().min(1).max(BLOCK_CONTRACT_LIMITS.maxUnitLength),
    default: usageNumber,
    min: usageNumber,
    max: usageNumber,
    integer: z.boolean(),
  })
  .refine((u) => u.min < u.max, { path: ['max'], message: 'Faixa vazia.' })
  .refine((u) => u.min <= u.default && u.default <= u.max, {
    path: ['default'],
    message: 'O padrão está fora da faixa.',
  })
  .refine((u) => !u.integer || [u.default, u.min, u.max].every(Number.isInteger), {
    path: ['integer'],
    message: 'Chave inteira com padrão ou faixa fracionária.',
  });

const blockDefinitionSchema = z
  .object({
    type: z.enum(BLOCK_TYPES),
    /** Nome do serviço, em inglês (PRD, "Requisitos transversais"). */
    name: z.string().min(1).max(BLOCK_CONTRACT_LIMITS.maxNameLength),
    category: z.enum(BLOCK_CATEGORIES),
    level: z.enum(['A', 'B', 'C']),
    attributes: fieldList(attributeSchema),
    usage: fieldList(usageKeySchema),
  })
  .refine((block) => block.level === PRD_BLOCK_LEVELS[block.type], {
    path: ['level'],
    message: 'Nível diferente do PRD.',
  });

/** `contracts/blocks.json`: o que cada bloco aceita. A API lê o mesmo arquivo. */
export const blocksFileSchema = z.object({
  schemaVersion: z.literal(1),
  blocks: z
    .array(blockDefinitionSchema)
    .max(BLOCK_TYPES.length)
    .refine(
      (blocks) => new Set(blocks.map((block) => block.type)).size === blocks.length,
      'Tipo de bloco repetido.',
    ),
});

const edgeKindSchema = z
  .object({
    kind: z.enum(EDGE_KINDS),
    usage: fieldList(usageKeySchema),
    /** A aresta é aceita se a origem está em `sources` e o destino em `targets` de algum par. */
    pairs: z
      .array(
        z.object({
          sources: z.array(z.enum(BLOCK_TYPES)).min(1),
          targets: z.array(z.enum([...BLOCK_TYPES, CLIENT_NODE_ID])).min(1),
        }),
      )
      .min(1)
      .max(BLOCK_CONTRACT_LIMITS.maxOptions),
  })
  .refine(
    (edge) => edge.kind === 'data' || edge.pairs.every((p) => !p.targets.includes(CLIENT_NODE_ID)),
    { path: ['pairs'], message: 'Só arestas de dados chegam à internet.' },
  );

/** `contracts/edges.json`: uso e pares de blocos aceitos por tipo de aresta. */
export const edgesFileSchema = z.object({
  schemaVersion: z.literal(1),
  kinds: z
    .array(edgeKindSchema)
    .refine(
      (kinds) =>
        kinds.length === EDGE_KINDS.length &&
        EDGE_KINDS.every((k) => kinds.some((e) => e.kind === k)),
      'Cada tipo de aresta aparece exatamente uma vez.',
    ),
});

export type BlockCategory = (typeof BLOCK_CATEGORIES)[number];
export type AttributeDefinition = z.infer<typeof attributeSchema>;
export type UsageKeyDefinition = z.infer<typeof usageKeySchema>;
export type BlockDefinition = z.infer<typeof blockDefinitionSchema>;
export type EdgeKindDefinition = z.infer<typeof edgeKindSchema>;

/**
 * O que a função de preço de um bloco recebe, já conforme o contrato do tipo (`blockPriceInput`):
 * toda chave de uso presente e dentro da faixa; atributos dentro das opções.
 */
export interface BlockPriceInput {
  readonly attributes: Block['attributes'];
  readonly usage: UsageValues;
}

/** Quantidade mensal de um SKU do catálogo. O motor aplica faixas, franquia e mínimo. */
export interface BlockCharge {
  /** SKU do catálogo (`Price.sku`). */
  readonly sku: string;
  /** Quantidade bruta do mês, na unidade do SKU e não negativa: sem franquia, mínimo nem faixas. */
  readonly quantity: Decimal;
  readonly charge: ChargeKind;
  /** Serviço do catálogo que tem o SKU. Sem ele, vale o do bloco: o tipo sem `aws.`. */
  readonly service?: string;
}

/** Função de preço de um bloco: pura, sem I/O; devolve o que cobrar, sem o valor em dólar. */
export type BlockPricer = (input: BlockPriceInput) => readonly BlockCharge[];
