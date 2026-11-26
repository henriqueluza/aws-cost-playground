import {
  CLIENT_NODE_ID,
  type DesignDocument,
  type Edge,
  type EdgeKind,
} from '../../../shared/lib/design';
import { EDGE_KIND_DEFINITIONS, edgeKindsFor, type EdgeKindDefinition } from '../../pricing';

/** Tipo de bloco de uma ponta (`client` para a internet); `undefined` se o bloco não existe. */
export function endpointType(doc: DesignDocument, id: string): string | undefined {
  return id === CLIENT_NODE_ID ? CLIENT_NODE_ID : doc.blocks.find((b) => b.id === id)?.type;
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

/** Aparência e legenda de cada tipo: o traçado (que a CSS desenha) e o texto. Dois sinais além da cor. */
export const EDGE_STYLE: Record<
  EdgeKind,
  { readonly label: string; readonly stroke: string; readonly meaning: string }
> = {
  data: { label: 'Dados', stroke: 'traço contínuo', meaning: 'tráfego entre serviços' },
  'runs-on': { label: 'Executa em', stroke: 'tracejado', meaning: 'ECS roda no EC2' },
  logs: { label: 'Logs', stroke: 'pontilhado', meaning: 'envio ao CloudWatch' },
};
