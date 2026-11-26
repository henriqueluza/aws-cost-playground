import { describe, expect, it } from 'vitest';
import apiServerless from '../../../../../contracts/scenarios/api-serverless.json';
import pipelineDeFilas from '../../../../../contracts/scenarios/pipeline-de-filas.json';
import type { DesignDocument, EdgeKind } from '../../../shared/lib/design';
import { exportDesign } from '../application/exportDesign';
import type { HclNode, HclValue } from '../model/hcl';
import { terraformName } from '../model/names';
import { block, design as kitDesign, edge, generate as kitGenerate } from './generatorKit';
import { INJECTION_PAYLOADS } from './injectionPayloads';

/**
 * Complemento de `generatorKit.ts` para os geradores dos blocos sem VPC: design em forma curta,
 * leitura estrutural de blocos aninhados e repetidos (declarações de política, origens) e a bateria
 * dos cenários de referência.
 */
export interface TestBlock {
  readonly id: string;
  readonly type: string;
  readonly label?: string;
  readonly attributes?: Record<string, string | number>;
  readonly usage?: Record<string, number>;
}
export type TestEdge = readonly [source: string, target: string, kind?: EdgeKind];
type Body = readonly HclNode[];

const blockId = (id: string) => (id === 'client' ? id : `blk_${id}`);

/** Design mínimo e válido. Os ids recebem o prefixo `blk_`; o rótulo padrão é o id. */
export const design = (blocks: readonly TestBlock[], edges: readonly TestEdge[] = []) =>
  kitDesign(
    blocks.map(({ id, type, label = id, attributes, usage }) =>
      block(blockId(id), type, attributes, usage, label),
    ),
    edges.map(([source, target, kind]) => edge(blockId(source), blockId(target), kind)),
  );

/** Nós de todos os blocos do design, pelo registro real. As arestas seguem a ordem do id (`edge`). */
export const generate = (blocks: readonly TestBlock[], edges: readonly TestEdge[] = []) =>
  kitGenerate(design(blocks, edges));

export function mainTf(document: unknown): string {
  const result = exportDesign(document);
  if (!result.ok) throw new Error(result.error);
  return result.files[0]?.content ?? '';
}

/** Linhas de código do arquivo, sem os comentários. */
export const code = (text: string) => text.split('\n').filter((line) => !/^\s*#/.test(line));

/** Corpos dos blocos `tipo "rótulo" ...` dentro de `nodes` (por exemplo `resource`, `aws_s3_bucket`). */
export function bodies(nodes: Body, type: string, ...labels: string[]): Body[] {
  return nodes.flatMap((node) =>
    node.kind === 'block' &&
    node.type === type &&
    labels.every((label, i) => node.labels[i] === label)
      ? [node.body]
      : [],
  );
}

/** O único bloco com esse tipo e rótulos; falha se não houver exatamente um. */
export function body(nodes: Body, type: string, ...labels: string[]): Body {
  const found = bodies(nodes, type, ...labels);
  if (found.length !== 1) throw new Error(`${found.length} blocos ${type} ${labels.join(' ')}`);
  return found[0] ?? [];
}

export function value(nodes: Body, name: string): HclValue | undefined {
  const found = nodes.find((node) => node.kind === 'attribute' && node.name === name);
  return found?.kind === 'attribute' ? found.value : undefined;
}

/** Valor sem o invólucro do nó: literal vira o valor, lista vira array; referência fica como está. */
export const plain = (node: HclValue | undefined): unknown =>
  node?.kind === 'list' ? node.items.map(plain) : node && 'value' in node ? node.value : node;

/** As declarações de `data "aws_iam_policy_document" "<label>"`. */
export const statements = (nodes: Body, label: string): Body[] =>
  bodies(body(nodes, 'data', 'aws_iam_policy_document', label), 'statement');

/** Tipos de recurso gerados, na ordem; com `owner`, só os do bloco com esse nome (e os derivados `__`). */
export const resourceTypes = (nodes: Body, owner?: string): string[] =>
  nodes.flatMap((node) => {
    if (node.kind !== 'block' || node.type !== 'resource') return [];
    const label = node.labels[1] ?? '';
    return !owner || label === owner || label.startsWith(`${owner}__`)
      ? [node.labels[0] ?? '']
      : [];
  });

/**
 * O mesmo documento com outro rótulo em cada bloco. `sanitized` troca a carga pelo nome que ela
 * gera: os dois exports têm os mesmos nomes de recurso e só podem diferir nos comentários.
 */
export function relabel(document: unknown, payload: string, sanitized = false): unknown {
  const doc = document as DesignDocument;
  const label = (type: string) =>
    sanitized ? terraformName(payload, type.replace(/^aws\./, '')) : payload;
  return { ...doc, blocks: doc.blocks.map((block) => ({ ...block, label: label(block.type) })) };
}

/**
 * Bateria comum aos geradores, sobre os dois cenários de referência que usam os blocos sem VPC:
 * nenhum bloco de `types` fica como não exportado, a saída não depende da ordem do documento e uma
 * carga de injeção no rótulo só muda comentários.
 */
export function describeReferenceScenarios(types: readonly string[]): void {
  describe.each([
    ['api-serverless', apiServerless as unknown as DesignDocument],
    ['pipeline-de-filas', pipelineDeFilas as unknown as DesignDocument],
  ])('cenário %s', (_name, document) => {
    it('exporta todos os blocos destes tipos', () => {
      const skipped = mainTf(document)
        .split('\n')
        .filter((line) => line.startsWith('# - '));
      expect(
        skipped.filter((line) => types.some((type) => line.startsWith(`# - ${type} `))),
      ).toEqual([]);
    });

    it('é determinístico e não depende da ordem dos blocos e das arestas', () => {
      const reversed = {
        ...document,
        blocks: [...document.blocks].reverse(),
        edges: [...document.edges].reverse(),
      };
      expect(mainTf(reversed)).toBe(mainTf(document));
    });

    it.each(INJECTION_PAYLOADS)('rótulo com a carga "%s" só muda comentários', (_n, payload) => {
      const label = payload.slice(0, 80);
      const text = mainTf(relabel(document, label));
      expect(code(text)).toEqual(code(mainTf(relabel(document, label, true))));
      expect(text.replaceAll('\n', '')).not.toMatch(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}]/u);
    });
  });
}
