import { describe, expect, it } from 'vitest';
import referenceJson from './referenceTemplate.json';
import {
  CLIENT_NODE_ID,
  DESIGN_LIMITS,
  designDocumentSchema,
  type DesignDocument,
} from '../../../../shared/lib/design';
import {
  BLOCKS,
  EDGE_KIND_DEFINITIONS,
  blockDefinition,
  edgeKindsFor,
  type UsageKeyDefinition,
} from '../../../pricing';
import { referenceDesign, referenceLayout } from './referenceTemplate';

/** PRD F2. Lista escrita à mão de propósito: não deriva do contrato testado. */
const TWENTY = (
  'route53 cloudfront waf alb ec2 ecs lambda elasticache rds dynamodb s3 sqs cognito iam ' +
  'secrets-manager cloudwatch cloudtrail codepipeline cloudformation nat-gateway'
)
  .split(' ')
  .map((name) => `aws.${name}`);

function rangeProblems(
  values: Record<string, number>,
  keys: readonly UsageKeyDefinition[],
): string[] {
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

function contractProblems(design: DesignDocument): string[] {
  const typeOf = new Map(design.blocks.map((block) => [block.id, block.type]));
  const blocks = design.blocks.flatMap((block) => {
    const definition = blockDefinition(block.type);
    if (!definition) return [`${block.id}: tipo fora do contrato: ${block.type}`];
    const attributes = definition.attributes.flatMap(({ key, options }) => {
      const value = block.attributes[key];
      if (value === undefined) return options.length > 0 ? [`atributo ausente: ${key}`] : [];
      return options.some((option) => option === value) ? [] : [`${key} fora das opções: ${value}`];
    });
    const unknown = Object.keys(block.attributes)
      .filter((key) => !definition.attributes.some((attribute) => attribute.key === key))
      .map((key) => `atributo desconhecido: ${key}`);
    return [...attributes, ...unknown, ...rangeProblems(block.usage.values, definition.usage)].map(
      (problem) => `${block.id}: ${problem}`,
    );
  });
  const edges = design.edges.flatMap((edge) => {
    const source = typeOf.get(edge.source) ?? '';
    const target =
      edge.target === CLIENT_NODE_ID ? CLIENT_NODE_ID : (typeOf.get(edge.target) ?? '');
    if (!edgeKindsFor(source, target).includes(edge.kind)) {
      return [`${edge.id}: par não permitido para ${edge.kind}: ${source} -> ${target}`];
    }
    const usage = EDGE_KIND_DEFINITIONS.find((d) => d.kind === edge.kind)?.usage ?? [];
    return rangeProblems(edge.usage.values, usage).map((problem) => `${edge.id}: ${problem}`);
  });
  return [...blocks, ...edges];
}

describe('template inicial (PRD F5)', () => {
  const design = referenceDesign();

  it('é um design válido e o schema não descarta nada do arquivo', () => {
    expect(designDocumentSchema.safeParse(referenceJson).success).toBe(true);
    expect(design).toEqual(referenceJson);
    expect(design.region).toBe('us-east-1');
  });

  it('traz os 20 blocos do MVP, cada tipo exatamente uma vez', () => {
    expect(design.blocks.map((block) => block.type).sort()).toEqual([...TWENTY].sort());
    expect(BLOCKS.map((block) => block.type).sort()).toEqual([...TWENTY].sort());
  });

  it('respeita o contrato de blocos e arestas, com uso explícito', () => {
    expect(contractProblems(design)).toEqual([]);
  });

  it('usa a carga padrão do contrato nos blocos e marca todo uso como default', () => {
    for (const block of design.blocks) {
      const defaults = Object.fromEntries(
        (blockDefinition(block.type)?.usage ?? []).map(({ key, default: value }) => [key, value]),
      );
      expect([block.id, block.usage.source, block.usage.values]).toEqual([
        block.id,
        'default',
        defaults,
      ]);
      expect(block.overrides).toEqual({});
    }
    for (const edge of design.edges) {
      expect([edge.id, edge.usage.source]).toEqual([edge.id, 'default']);
      expect(edge.overrides).toEqual({});
    }
  });

  it('tem uma descrição de carga de exemplo dentro do limite, sem dado pessoal', () => {
    const { description } = design.workload;
    expect(description.length).toBeGreaterThan(100);
    expect(description.length).toBeLessThanOrEqual(DESIGN_LIMITS.maxDescriptionLength);
    expect(description).not.toMatch(/@|https?:|\d{3}\.\d{3}\.\d{3}/);
  });

  it('liga todo bloco a pelo menos uma aresta e o ECS ao EC2 em que roda', () => {
    const connected = new Set(design.edges.flatMap((edge) => [edge.source, edge.target]));
    expect(design.blocks.filter((block) => !connected.has(block.id))).toEqual([]);
    const idOf = (type: string) => design.blocks.find((block) => block.type === type)?.id;
    expect(
      design.edges.some(
        (edge) =>
          edge.kind === 'runs-on' &&
          edge.source === idOf('aws.ecs') &&
          edge.target === idOf('aws.ec2'),
      ),
    ).toBe(true);
    expect(design.edges.some((edge) => edge.target === CLIENT_NODE_ID)).toBe(true);
  });

  it('devolve cópias novas a cada chamada', () => {
    const first = referenceDesign();
    first.blocks.pop();
    expect(referenceDesign().blocks).toHaveLength(20);
  });
});

describe('posições do template', () => {
  const design = referenceDesign();
  const layout = referenceLayout();
  /** Largura de `--node-width`; a altura do bloco é menor que o passo de 128 px. */
  const NODE = { width: 216, height: 96 };

  it('dá posição a cada bloco e ao client, e a mais ninguém', () => {
    expect(Object.keys(layout).sort()).toEqual(
      [CLIENT_NODE_ID, ...design.blocks.map((block) => block.id)].sort(),
    );
  });

  it('não sobrepõe nenhum par de nós', () => {
    const entries = Object.entries(layout);
    const overlaps = entries.flatMap(([a, pa], i) =>
      entries
        .slice(i + 1)
        .flatMap(([b, pb]) =>
          Math.abs(pa.x - pb.x) < NODE.width && Math.abs(pa.y - pb.y) < NODE.height
            ? [`${a} x ${b}`]
            : [],
        ),
    );
    expect(overlaps).toEqual([]);
  });

  it('flui da esquerda para a direita: toda aresta chega a uma coluna mais à direita', () => {
    const backwards = design.edges.filter((edge) => {
      const from = layout[edge.source];
      const to = layout[edge.target];
      return !from || !to || to.x <= from.x;
    });
    expect(backwards.map((edge) => edge.id)).toEqual([]);
  });
});
