import { describe, expect, it } from 'vitest';
import apiServerless from '../../../../../contracts/scenarios/api-serverless.json';
import appClassico from '../../../../../contracts/scenarios/app-classico.json';
import pipelineDeFilas from '../../../../../contracts/scenarios/pipeline-de-filas.json';
import {
  CLIENT_NODE_ID,
  designDocumentSchema,
  type DesignDocument,
  type UsageValues,
} from '../../../shared/lib/design';
import {
  EDGE_KIND_DEFINITIONS,
  blockDefinition,
  edgeKindsFor,
  type UsageKeyDefinition,
} from '../model/blockRegistry';

/** Os três cenários do critério 2 do MVP (PRD), descritos em `docs/scenarios.md`. */
const scenarios: Record<string, unknown> = {
  'api-serverless': apiServerless,
  'app-classico': appClassico,
  'pipeline-de-filas': pipelineDeFilas,
};

/** PRD F10. Lista escrita à mão de propósito: não deriva do contrato testado. */
const levelABlocks =
  'ec2 lambda rds dynamodb elasticache s3 sqs cloudfront alb cloudwatch nat-gateway'
    .split(' ')
    .map((name) => `aws.${name}`);

/** Uso explícito: todas as chaves do contrato, nenhuma a mais, cada valor dentro da faixa. */
function usageProblems(values: UsageValues, keys: readonly UsageKeyDefinition[]): string[] {
  const known = new Set(keys.map((definition) => definition.key));
  const unknown = Object.keys(values)
    .filter((key) => !known.has(key))
    .map((key) => `chave de uso desconhecida: ${key}`);
  const invalid = keys.flatMap(({ key, min, max, integer }) => {
    const value = values[key];
    if (value === undefined) return [`chave de uso ausente: ${key}`];
    if (value < min || value > max) return [`${key} fora da faixa de ${min} a ${max}: ${value}`];
    return integer && !Number.isInteger(value) ? [`${key} deveria ser inteiro: ${value}`] : [];
  });
  return [...unknown, ...invalid];
}

/** Confere um design contra `contracts/blocks.json` e `contracts/edges.json`. Lista vazia: válido. */
function contractProblems(design: DesignDocument): string[] {
  const typeOf = new Map(design.blocks.map((block) => [block.id, block.type]));
  const blockProblems = design.blocks.flatMap((block) => {
    const definition = blockDefinition(block.type);
    if (!definition) return [`${block.id}: tipo fora do contrato: ${block.type}`];
    // Cenário de referência não depende de padrão: todo atributo é escrito, inclusive o `az` opcional.
    const attributes = definition.attributes.flatMap(({ key, options }) => {
      const value = block.attributes[key];
      if (value === undefined) return [`atributo ausente: ${key}`];
      return options.some((option) => option === value) ? [] : [`${key} fora das opções: ${value}`];
    });
    const unknown = Object.keys(block.attributes)
      .filter((key) => !definition.attributes.some((attribute) => attribute.key === key))
      .map((key) => `atributo desconhecido: ${key}`);
    const overrides = Object.keys(block.overrides).map((key) => `override inesperado: ${key}`);
    return [
      ...attributes,
      ...unknown,
      ...overrides,
      ...usageProblems(block.usage.values, definition.usage),
    ].map((problem) => `${block.id}: ${problem}`);
  });
  const edgeProblems = design.edges.flatMap((edge) => {
    const source = typeOf.get(edge.source) ?? '';
    const target =
      edge.target === CLIENT_NODE_ID ? CLIENT_NODE_ID : (typeOf.get(edge.target) ?? '');
    if (!edgeKindsFor(source, target).includes(edge.kind)) {
      return [`${edge.id}: par não permitido para ${edge.kind}: ${source} -> ${target}`];
    }
    const usage = EDGE_KIND_DEFINITIONS.find((definition) => definition.kind === edge.kind)?.usage;
    const overrides = Object.keys(edge.overrides).map((key) => `override inesperado: ${key}`);
    return [...overrides, ...usageProblems(edge.usage.values, usage ?? [])].map(
      (problem) => `${edge.id}: ${problem}`,
    );
  });
  return [...blockProblems, ...edgeProblems];
}

const parsed = (name: string) => designDocumentSchema.parse(scenarios[name]);

describe('contracts/scenarios', () => {
  it.each(Object.keys(scenarios))('%s é um design válido, em us-east-1', (name) => {
    const design = parsed(name);
    expect(design.region).toBe('us-east-1');
    expect(design.blocks.length).toBeGreaterThan(0);
    expect(design.edges.length).toBeGreaterThan(0);
    // Nenhuma chave descartada pela leitura tolerante: o arquivo é exatamente o que o schema lê.
    expect(design).toEqual(scenarios[name]);
  });

  it.each(Object.keys(scenarios))(
    '%s respeita o contrato dos blocos e das arestas, com uso explícito',
    (name) => {
      expect(contractProblems(parsed(name))).toEqual([]);
    },
  );

  it.each(Object.keys(scenarios))('%s liga todo bloco a pelo menos uma aresta', (name) => {
    const design = parsed(name);
    const connected = new Set(design.edges.flatMap((edge) => [edge.source, edge.target]));
    expect(design.blocks.filter((block) => !connected.has(block.id))).toEqual([]);
  });

  it('juntos, os três usam todos os blocos de nível A', () => {
    const used = new Set(
      Object.keys(scenarios).flatMap((name) => parsed(name).blocks.map((block) => block.type)),
    );
    expect(levelABlocks.filter((type) => !used.has(type))).toEqual([]);
    expect(levelABlocks.map((type) => blockDefinition(type)?.level)).toEqual(
      levelABlocks.map(() => 'A'),
    );
  });
});

describe('conferência contra o contrato', () => {
  const base = parsed('api-serverless');
  const withBlock = (change: (block: DesignDocument['blocks'][number]) => void) => {
    const design = structuredClone(base);
    const block = design.blocks.find(({ id }) => id === 'blk_api');
    if (!block) throw new Error('O cenário perdeu o bloco blk_api.');
    change(block);
    return contractProblems(design);
  };

  it.each([
    ['tipo fora do contrato', withBlock((block) => (block.type = 'aws.apigateway'))],
    ['fora das opções', withBlock((block) => (block.attributes.memoryMb = 300))],
    ['atributo ausente', withBlock((block) => delete block.attributes.architecture)],
    ['atributo desconhecido', withBlock((block) => (block.attributes.runtime = 'python'))],
    ['chave de uso ausente', withBlock((block) => delete block.usage.values.avgDurationMs)],
    ['chave de uso desconhecida', withBlock((block) => (block.usage.values.storageGb = 1))],
    ['fora da faixa', withBlock((block) => (block.usage.values.avgDurationMs = 0))],
    ['deveria ser inteiro', withBlock((block) => (block.usage.values.avgDurationMs = 1.5))],
    ['override inesperado', withBlock((block) => (block.overrides.avgDurationMs = 80))],
  ])('aponta %s', (problem, found) => {
    // Tipo desconhecido também invalida as arestas do bloco: aqui só contam os problemas do bloco.
    const ofBlock = found.filter((line) => line.startsWith('blk_api: '));
    expect(ofBlock).toHaveLength(1);
    expect(ofBlock[0]).toContain(problem);
  });

  it('aponta aresta com par não permitido', () => {
    const design = structuredClone(base);
    // DynamoDB não fala direto com a internet: `client` só aceita CloudFront, S3, ALB e EC2.
    design.edges.push({ ...design.edges[0]!, id: 'edg_x', source: 'blk_table' });
    expect(contractProblems(design)).toEqual([
      'edg_x: par não permitido para data: aws.dynamodb -> client',
    ]);
  });
});
