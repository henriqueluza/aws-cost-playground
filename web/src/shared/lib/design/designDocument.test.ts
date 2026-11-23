import { describe, expect, it } from 'vitest';
import { adrExampleDesign, designWithBlocks } from '../../../test/designFixtures';
import { CLIENT_NODE_ID, DESIGN_LIMITS, EDGE_KINDS, REGIONS, designDocumentSchema } from '.';

type Node = Record<string, unknown>;
const at = (value: unknown, keys: string[]) =>
  keys.reduce((node, key) => (node as Node)[key], value);
/** Clona o exemplo do ADR e grava `value` no caminho pontuado (`'blocks.0.label'`). */
function variant(path: string, value: unknown): unknown {
  const doc = structuredClone(adrExampleDesign);
  const keys = path.split('.');
  (at(doc, keys.slice(0, -1)) as Node)[String(keys.at(-1))] = value;
  return doc;
}
const parse = (input: unknown) => designDocumentSchema.safeParse(input);
const issuePaths = (input: unknown) => parse(input).error?.issues.map((issue) => issue.path);
const [lambda] = adrExampleDesign.blocks;
const [egress] = adrExampleDesign.edges;
const { maxBlocks, maxEdges, maxDescriptionLength, maxLabelLength, maxUsageValue } = DESIGN_LIMITS;
const { maxFieldsPerRecord } = DESIGN_LIMITS;
const fields = (count: number) =>
  Object.fromEntries(Array.from({ length: count }, (_, i) => [`k${i}`, 1]));
const egressEdges = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ ...egress, id: `edg_${i}` }));
const duration = 'blocks.0.usage.values.avgDurationMs';
const unknownKeys = ['futureField', 'workload.tag', 'blocks.0.color', 'edges.0.weight'];

describe('designDocumentSchema (ADR-0001, "Modelo de dados")', () => {
  it('aceita o exemplo do ADR, com aresta data para client e llm sem estimatedAt', () => {
    expect(egress).toMatchObject({ target: CLIENT_NODE_ID, usage: { source: 'llm' } });
    expect(egress).toHaveProperty('kind', 'data');
    expect(egress).not.toHaveProperty('usage.estimatedAt');
    const result = parse(structuredClone(adrExampleDesign));
    expect(result.success).toBe(true);
    expect(result.data).toEqual(adrExampleDesign);
  });

  it.each(EDGE_KINDS)('aceita aresta %s entre dois blocos', (kind) => {
    const edge = { ...egress, id: 'edg_2', source: 'blk_fn_api', target: 'blk_assets', kind };
    expect(parse(variant('edges.1', edge)).success).toBe(true);
  });

  it.each(REGIONS)('aceita a região %s', (region) => {
    expect(parse(variant('region', region)).success).toBe(true);
  });

  it.each([
    ['design sem blocos nem arestas', designWithBlocks(0)],
    ['descrição vazia', variant('workload.description', '')],
    ['descrição no limite', variant('workload.description', 'a'.repeat(maxDescriptionLength))],
    ['rótulo no limite', variant('blocks.0.label', 'a'.repeat(maxLabelLength))],
    ['atributo string com 64 caracteres', variant('blocks.0.attributes.a', 'a'.repeat(64))],
    ['valor de uso zero', variant(duration, 0)],
    ['valor de uso no teto', variant(duration, maxUsageValue)],
    ['chaves de uso no limite', variant('blocks.0.usage.values', fields(maxFieldsPerRecord))],
    ['atributos no limite', variant('blocks.0.attributes', fields(maxFieldsPerRecord))],
    ['overrides no limite', variant('edges.0.overrides', fields(maxFieldsPerRecord))],
  ])('aceita no limite: %s', (_name, input) => {
    expect(parse(input).success).toBe(true);
  });

  it('aceita até maxBlocks blocos e recusa um a mais', () => {
    expect(parse(designWithBlocks(maxBlocks)).success).toBe(true);
    expect(issuePaths(designWithBlocks(maxBlocks + 1))).toEqual([['blocks']]);
  });

  it('aceita até maxEdges arestas e recusa uma a mais', () => {
    expect(parse(variant('edges', egressEdges(maxEdges))).success).toBe(true);
    expect(issuePaths(variant('edges', egressEdges(maxEdges + 1)))).toEqual([['edges']]);
  });

  it.each(unknownKeys)('descarta a chave desconhecida %s (leitura tolerante)', (path) => {
    const result = parse(variant(path, 'x'));
    expect(result.success).toBe(true);
    expect(result.data).toEqual(adrExampleDesign);
  });

  it.each([
    'blocks.0.usage.values',
    'blocks.0.attributes',
    'blocks.0.overrides',
    'edges.0.overrides',
  ])('descarta __proto__ vindo de JSON.parse em %s sem poluir o protótipo', (path) => {
    const hostile: unknown = JSON.parse('{"__proto__":{"polluted":true},"gbPerMonth":1}');
    const result = parse(variant(path, hostile));
    expect(result.success).toBe(true);
    const record = at(result.data, path.split('.')) as Node;
    expect(Object.keys(record)).toEqual(['gbPerMonth']);
    expect(Object.getPrototypeOf(record)).toBe(Object.prototype);
    expect(record.polluted).toBeUndefined();
    expect(({} as Node).polluted).toBeUndefined();
  });

  it.each([null, [], 'design', 1])('recusa entrada que não é objeto: %j', (input) => {
    expect(parse(input).success).toBe(false);
  });

  it.each([
    ['schemaVersion 2', 'schemaVersion', 2],
    ['região desconhecida', 'region', 'eu-west-1'],
    ['kind desconhecido', 'edges.0.kind', 'stream'],
    ['usage.source desconhecido', 'blocks.0.usage.source', 'override'],
    ['descrição longa', 'workload.description', 'a'.repeat(maxDescriptionLength + 1)],
    ['rótulo longo', 'blocks.0.label', 'a'.repeat(maxLabelLength + 1)],
    ['valor de uso negativo', duration, -1],
    ['valor de uso NaN', duration, NaN],
    ['valor de uso Infinity', duration, Infinity],
    ['valor de uso acima do teto', duration, maxUsageValue * 10],
    ['override negativo', 'blocks.0.overrides.avgDurationMs', -1],
    ['override acima do teto', 'blocks.0.overrides.avgDurationMs', maxUsageValue * 10],
    ['scenarios não vazio', 'scenarios', [{ id: 'scn_1' }]],
    ['chave de uso fora do camelCase', 'blocks.0.usage.values.Memory-MB', 1],
    ['chave de atributo fora do camelCase', 'blocks.0.attributes.Memory-MB', 1],
    ['chave de uso constructor', 'blocks.0.usage.values.constructor', 1],
    ['chave de uso toString', 'blocks.0.usage.values.toString', 1],
    ['chave de atributo constructor', 'blocks.0.attributes.constructor', 1],
    ['chave de atributo toString', 'blocks.0.attributes.toString', 1],
    ['atributo string com 65 caracteres', 'blocks.0.attributes.a', 'a'.repeat(65)],
    ['estimatedAt que não é data ISO', 'blocks.0.usage.estimatedAt', '18/11/2026'],
    ['estimatedAt fora de UTC', 'blocks.0.usage.estimatedAt', '2026-11-18T11:00:00-03:00'],
    ['id de bloco sem prefixo blk_', 'blocks.0.id', 'fn_api'],
    ['overrides ausente', 'blocks.0.overrides', undefined],
    ['chaves de uso demais', 'blocks.0.usage.values', fields(maxFieldsPerRecord + 1)],
    ['atributos demais', 'blocks.0.attributes', fields(maxFieldsPerRecord + 1)],
    ['overrides demais', 'edges.0.overrides', fields(maxFieldsPerRecord + 1)],
  ])('recusa %s, só no campo alterado', (_name, path, value) => {
    const paths = issuePaths(variant(path, value))?.map((issuePath) => issuePath.join('.'));
    expect(paths).toEqual([path]);
  });

  it.each([
    ['id de bloco repetido', variant('blocks.2', lambda), ['blocks', 2, 'id']],
    ['id de aresta repetido', variant('edges.1', egress), ['edges', 1, 'id']],
    ['source inexistente', variant('edges.0.source', 'blk_missing'), ['edges', 0, 'source']],
    ['target inexistente', variant('edges.0.target', 'blk_missing'), ['edges', 0, 'target']],
    ['source client', variant('edges.0.source', CLIENT_NODE_ID), ['edges', 0, 'source']],
    ['runs-on para client', variant('edges.0.kind', 'runs-on'), ['edges', 0, 'kind']],
    ['logs para client', variant('edges.0.kind', 'logs'), ['edges', 0, 'kind']],
    ['auto-laço', variant('edges.0.target', 'blk_assets'), ['edges', 0, 'target']],
  ])('recusa por integridade: %s, no caminho certo', (_name, input, path) => {
    expect(parse(input).success).toBe(false);
    expect(issuePaths(input)).toContainEqual(path);
  });
});
