import {
  CLIENT_NODE_ID,
  type DesignDocument,
  type Edge,
  type EdgeKind,
} from '../../../shared/lib/design';
import {
  EDGE_KIND_DEFINITIONS,
  EDGE_SKUS,
  blockDefinition,
  edgeCharges,
  edgeKindsFor,
  type EdgeKindDefinition,
} from '../../pricing';

/** Tipo de bloco de uma ponta (`client` para a internet); `undefined` se o bloco não existe. */
export function endpointType(doc: DesignDocument, id: string): string | undefined {
  return id === CLIENT_NODE_ID ? CLIENT_NODE_ID : doc.blocks.find((b) => b.id === id)?.type;
}

/** Nome do serviço de uma ponta, só do contrato (nunca o rótulo do usuário). */
export function endpointService(doc: DesignDocument, id: string): string {
  if (id === CLIENT_NODE_ID) return 'Internet';
  const type = endpointType(doc, id);
  return (type && blockDefinition(type)?.name) || 'Bloco';
}

export const edgeKindDefinition = (kind: EdgeKind): EdgeKindDefinition | undefined =>
  EDGE_KIND_DEFINITIONS.find((definition) => definition.kind === kind);

/** Quantos pares origem/destino o contrato aceita para o tipo: quanto menos, mais específico. */
function breadth(kind: EdgeKind): number {
  return (edgeKindDefinition(kind)?.pairs ?? []).reduce(
    (sum, pair) => sum + pair.sources.length * pair.targets.length,
    0,
  );
}

/**
 * Tipos permitidos para o par, na ordem do contrato. Vazio: o contrato não prevê a conexão.
 * `sourceType` não pode ser `client`.
 */
export function allowedKinds(sourceType: string, targetType: string): EdgeKind[] {
  return edgeKindsFor(sourceType, targetType);
}

/**
 * Tipo inferido para o par: o mais específico entre os permitidos (o que o contrato aceita em
 * menos pares; empate, a ordem do contrato). ECS para EC2 vira `runs-on`, não `data`.
 */
export function inferKind(kinds: readonly EdgeKind[]): EdgeKind | undefined {
  return kinds.reduce<EdgeKind | undefined>(
    (best, kind) => (best === undefined || breadth(kind) < breadth(best) ? kind : best),
    undefined,
  );
}

type Priced = Pick<Edge, 'usage' | 'overrides'>;

const fit = (value: number, key: { min: number; max: number; integer: boolean }): number => {
  const clamped = Math.min(key.max, Math.max(key.min, value));
  return key.integer ? Math.round(clamped) : clamped;
};

/**
 * Uso e override da aresta depois de trocar o tipo. Regra: fica só o que o novo tipo tem no
 * contrato (a chave que ele não tem, como `gbPerMonth` em `runs-on`, é descartada); o que fica
 * é limitado à faixa do novo tipo (e arredondado se for inteiro). A origem do uso não muda.
 */
export function retargetUsage(edge: Priced, to: EdgeKind): Priced {
  const keys = edgeKindDefinition(to)?.usage ?? [];
  const adjust = (values: Readonly<Record<string, number>>): Record<string, number> =>
    Object.fromEntries(
      keys.flatMap((key) => {
        const value = Object.hasOwn(values, key.key) ? values[key.key] : undefined;
        return value === undefined ? [] : [[key.key, fit(value, key)] as const];
      }),
    );
  return {
    usage: { source: edge.usage.source, values: adjust(edge.usage.values) },
    overrides: adjust(edge.overrides),
  };
}

export type EdgeCostNote = { readonly costs: boolean; readonly text: string };

const COST_TEXT: Record<string, string> = {
  [EDGE_SKUS.internetOut.sku]: 'saída de dados da região para a internet, cobrada por GB',
  [EDGE_SKUS.cloudFrontOut.sku]:
    'saída do CloudFront para a internet, cobrada por GB (com a franquia própria do CloudFront)',
  [EDGE_SKUS.natProcessed.sku]: 'o NAT Gateway cobra cada GB que processa',
  [EDGE_SKUS.interAz.sku]:
    'tráfego entre zonas de disponibilidade diferentes, cobrado nas duas direções',
  [EDGE_SKUS.logsIngested.sku]: 'ingestão de logs no CloudWatch, cobrada por GB',
};

/**
 * Diz se a aresta custa e por quê, pelas regras do motor (`edgeCharges`), sem consultar preço.
 * Texto fixo da interface: nada do que o usuário digitou entra aqui.
 */
export function edgeCostNote(doc: DesignDocument, edge: Edge): EdgeCostNote {
  const charges = edgeCharges(edge, (id) => doc.blocks.find((b) => b.id === id), blockDefinition);
  if (charges === undefined) {
    return {
      costs: false,
      text: 'Esta conexão não está no contrato, então fica fora da estimativa.',
    };
  }
  const first = charges[0];
  if (first) {
    return { costs: true, text: `Custa: ${COST_TEXT[first.sku] ?? 'transferência de dados'}.` };
  }
  return edge.kind === 'runs-on'
    ? { costs: false, text: 'Não custa aqui: o custo do ECS está no EC2 que o executa.' }
    : {
        costs: false,
        text: 'Não custa: nesta combinação (mesma zona, ou uma ponta sem zona) a AWS não cobra a transferência.',
      };
}

export type ConnectTarget = {
  readonly id: string;
  /** Texto do serviço, mais o rótulo do usuário (só texto) quando é bloco. */
  readonly name: string;
  readonly kinds: readonly EdgeKind[];
  readonly kind: EdgeKind;
};

/** Destinos que o contrato permite a partir de um bloco, sem os já ligados a ele (duplicata). */
export function connectTargets(doc: DesignDocument, sourceId: string): ConnectTarget[] {
  const source = endpointType(doc, sourceId);
  if (source === undefined || sourceId === CLIENT_NODE_ID) return [];
  const linked = new Set(doc.edges.filter((e) => e.source === sourceId).map((e) => e.target));
  const candidates = [
    ...doc.blocks
      .filter((b) => b.id !== sourceId)
      .map((b) => ({
        id: b.id,
        type: b.type,
        name:
          b.label.trim() === ''
            ? endpointService(doc, b.id)
            : `${endpointService(doc, b.id)}, ${b.label}`,
      })),
    { id: CLIENT_NODE_ID, type: CLIENT_NODE_ID, name: 'Internet' },
  ];
  return candidates.flatMap((candidate) => {
    const kinds = allowedKinds(source, candidate.type);
    const kind = inferKind(kinds);
    return kind === undefined || linked.has(candidate.id)
      ? []
      : [{ id: candidate.id, name: candidate.name, kinds, kind }];
  });
}

/** Aparência e legenda de cada tipo: o traçado (que a CSS desenha) e o texto. Dois sinais além da cor. */
export const EDGE_STYLE: Record<
  EdgeKind,
  { readonly label: string; readonly stroke: string; readonly meaning: string }
> = {
  data: { label: 'Dados', stroke: 'traço contínuo', meaning: 'tráfego entre serviços' },
  'runs-on': { label: 'Executa em', stroke: 'tracejado', meaning: 'ECS roda no EC2' },
  logs: { label: 'Logs', stroke: 'pontilhado', meaning: 'envio ao CloudWatch' },
};
