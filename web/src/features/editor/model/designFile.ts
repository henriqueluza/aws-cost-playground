import {
  CURRENT_SCHEMA_VERSION,
  DESIGN_LIMITS,
  designDocumentSchema,
  type DesignDocument,
} from '../../../shared/lib/design';

/**
 * Por que um arquivo não abre. A frase para o usuário é de `designFileMessage`: nada do arquivo
 * (trecho, caminho, `SyntaxError`, mensagem do zod) chega à interface.
 */
export type DesignFileError =
  'too-large' | 'unreadable' | 'not-json' | 'not-design' | 'unsupported-version';
export type DesignFileResult =
  | { readonly ok: true; readonly document: DesignDocument }
  | { readonly ok: false; readonly error: DesignFileError };

/** Só o que a leitura precisa de um `File`: o tamanho (conferido antes) e o texto. */
export type DesignFileSource = { readonly size: number; text(): Promise<string> };

/** Texto fixo da interface por categoria de erro. */
const MESSAGES: Record<DesignFileError, string> = {
  'too-large': `O arquivo passa de ${DESIGN_LIMITS.maxDocBytes / 1024} KB, o tamanho máximo de um design. Escolha outro arquivo.`,
  unreadable: 'Não foi possível ler o arquivo.',
  'not-json': 'O arquivo não é um JSON válido. Escolha um arquivo baixado deste editor.',
  'not-design': 'O arquivo não é um design deste produto. Escolha um arquivo baixado deste editor.',
  'unsupported-version':
    'O arquivo é de uma versão do design que este editor não abre. Atualize o editor ou baixe o design de novo.',
};
export const designFileMessage = (error: DesignFileError): string => MESSAGES[error];

/** Nome fixo do arquivo baixado: o documento não tem nome de design, e nome fixo não carrega entrada. */
export const DESIGN_FILE_NAME = 'aws-cost-playground-design.json';
export const DESIGN_FILE_MIME = 'application/json';

/** Passos de versão antiga para a atual, pela `schemaVersion` de origem. Vazio: só a 1 existe. */
export type Migrations = Readonly<Record<number, (raw: unknown) => unknown>>;
const MIGRATIONS: Migrations = {};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Ponto de migração entre versões: leva o JSON cru até a versão atual, antes do schema. Só compara
 * `schemaVersion` (inteiro) com as versões que conhece; nenhum outro campo é lido. Versão
 * desconhecida, futura ou sem passo de migração é recusada.
 */
export function migrateDesign(
  raw: unknown,
  migrations: Migrations = MIGRATIONS,
  current: number = CURRENT_SCHEMA_VERSION,
): { ok: true; raw: unknown } | { ok: false; error: 'unsupported-version' } {
  if (!isRecord(raw) || !Object.hasOwn(raw, 'schemaVersion')) return { ok: true, raw };
  const first = raw.schemaVersion;
  if (typeof first !== 'number' || !Number.isInteger(first) || first === current) {
    return { ok: true, raw }; // o schema julga (tipo errado, ou a versão atual)
  }
  let version: number = first;
  let migrated: unknown = raw;
  while (version !== current) {
    const step = Object.hasOwn(migrations, version) ? migrations[version] : undefined;
    if (step === undefined) return { ok: false, error: 'unsupported-version' };
    migrated = step(migrated);
    const next: unknown = isRecord(migrated) ? migrated.schemaVersion : undefined;
    // Passo que não avança a versão recusaria em laço: recusado.
    if (typeof next !== 'number' || next === version)
      return { ok: false, error: 'unsupported-version' };
    version = next;
  }
  return { ok: true, raw: migrated };
}

/**
 * Conta, no texto, as chaves `"id": "blk_..."` (só aparecem fora de string: dentro dela a aspa vem
 * escapada) e recusa mais de `maxBlocks`: o limite de blocos vale antes do parse completo.
 */
function exceedsBlockLimit(text: string): boolean {
  const ids = text.matchAll(/"id"\s*:\s*"blk_/g);
  return Array.from(ids).length > DESIGN_LIMITS.maxBlocks;
}

/** JSON.parse puro e depois o schema; o primeiro erro vira só uma categoria. */
export function parseDesignFile(text: string): DesignFileResult {
  if (text.length > DESIGN_LIMITS.maxDocBytes) return { ok: false, error: 'too-large' };
  if (exceedsBlockLimit(text)) return { ok: false, error: 'not-design' };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'not-json' };
  }
  const migrated = migrateDesign(raw);
  if (!migrated.ok) return migrated;
  const parsed = designDocumentSchema.safeParse(migrated.raw);
  return parsed.success ? { ok: true, document: parsed.data } : { ok: false, error: 'not-design' };
}

/**
 * Lê o arquivo escolhido pelo usuário (entrada não confiável). O tamanho é conferido antes de ler
 * o conteúdo: arquivo grande demais nem é lido, o que também limita o custo do parse e do
 * aninhamento. Extensão e tipo MIME não entram: vale o parse mais o schema.
 */
export async function readDesignFile(file: DesignFileSource): Promise<DesignFileResult> {
  if (file.size > DESIGN_LIMITS.maxDocBytes) return { ok: false, error: 'too-large' };
  let text: string;
  try {
    text = await file.text();
  } catch {
    return { ok: false, error: 'unreadable' };
  }
  return parseDesignFile(text);
}

/** Records com as chaves em ordem alfabética: o mesmo documento dá sempre os mesmos bytes. */
const sorted = <T extends Record<string, unknown>>(record: T): T =>
  Object.fromEntries(Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) as T;

/**
 * Serializa o documento: só as chaves do contrato (o schema descarta o resto), sem estado de UI,
 * com 2 espaços e quebra de linha final. `null` se o documento não valida ou passa do teto de
 * tamanho (o arquivo não abriria de volta).
 */
export function serializeDesign(doc: DesignDocument): string | null {
  const parsed = designDocumentSchema.safeParse(doc);
  if (!parsed.success) return null;
  const { blocks, edges, ...rest } = parsed.data;
  const canonical = {
    schemaVersion: rest.schemaVersion,
    region: rest.region,
    workload: rest.workload,
    blocks: blocks.map((b) => ({
      ...b,
      attributes: sorted(b.attributes),
      usage: { ...b.usage, values: sorted(b.usage.values) },
      overrides: sorted(b.overrides),
    })),
    edges: edges.map((e) => ({
      ...e,
      usage: { ...e.usage, values: sorted(e.usage.values) },
      overrides: sorted(e.overrides),
    })),
    scenarios: rest.scenarios,
  };
  const text = `${JSON.stringify(canonical, null, 2)}\n`;
  return new TextEncoder().encode(text).length > DESIGN_LIMITS.maxDocBytes ? null : text;
}
