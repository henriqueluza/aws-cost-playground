import type { Block, DesignDocument, Edge } from '../../../shared/lib/design';
import { buildExportModel } from '../model/exportBlocks';
import { BLOCK_GENERATORS } from '../model/generators';
import { hcl, renderHcl, type HclNode } from '../model/hcl';

/** Apoio dos testes de gerador: monta designs pequenos e lê os nós gerados pela estrutura. */
export const block = (
  id: string,
  type: string,
  attributes: Block['attributes'] = {},
  values: Record<string, number> = {},
  label = id,
): Block => ({ id, type, label, attributes, usage: { source: 'default', values }, overrides: {} });

export const edge = (source: string, target: string, kind: Edge['kind'] = 'data'): Edge => ({
  id: `edg_${source}_${target}_${kind}`,
  source,
  target,
  kind,
  usage: { source: 'default', values: {} },
  overrides: {},
});

export const design = (blocks: Block[], edges: Edge[] = []): DesignDocument => ({
  schemaVersion: 1,
  region: 'us-east-1',
  workload: { description: 'teste' },
  blocks,
  edges,
  scenarios: [],
});

type BlockNode = Extract<HclNode, { kind: 'block' }>;

/** Nós de todos os blocos do design, na ordem em que o export os escreve. */
export function generate(document: DesignDocument): readonly HclNode[] {
  const model = buildExportModel(document);
  return model.blocks.flatMap(
    (current) =>
      BLOCK_GENERATORS[current.type]({
        block: current,
        links: model.links.get(current.id) ?? [],
        blocks: model.blocks,
        designLinks: model.links,
        region: document.region,
      }).nodes,
  );
}

/** Blocos `resource` (ou `data`, `variable`) de um tipo; sem tipo, todos os de primeiro nível. */
export const blocksOf = (nodes: readonly HclNode[], type?: string, kind = 'resource') =>
  nodes.filter(
    (node): node is BlockNode =>
      node.kind === 'block' && node.type === kind && (!type || node.labels[0] === type),
  );

export const named = (nodes: readonly HclNode[], type: string, name: string): BlockNode => {
  const found = blocksOf(nodes, type).find((node) => node.labels[1] === name);
  if (!found) throw new Error(`recurso ${type}.${name} não foi gerado`);
  return found;
};

/** Atributos de um bloco (e dos blocos aninhados) como texto de HCL, por nome. */
export function attrs(node: BlockNode): Record<string, string> {
  const out: Record<string, string> = {};
  for (const child of node.body) {
    if (child.kind === 'attribute') {
      out[child.name] = renderHcl([hcl.attr('v', child.value)])
        .slice(4)
        .trimEnd();
    } else if (child.kind === 'block') {
      for (const [name, value] of Object.entries(attrs(child)))
        out[`${child.type}.${name}`] = value;
    }
  }
  return out;
}

export const labels = (nodes: readonly HclNode[], type: string) =>
  blocksOf(nodes, type).map((node) => node.labels[1]);
