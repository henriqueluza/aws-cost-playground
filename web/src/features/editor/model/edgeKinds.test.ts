import { describe, expect, it } from 'vitest';
import edgesFile from '../../../../../contracts/edges.json';
import { CLIENT_NODE_ID, type EdgeKind } from '../../../shared/lib/design';
import { BLOCK_TYPES } from '../../pricing';
import { allowedKinds, EDGE_STYLE, inferKind, retargetUsage } from './edgeKinds';

const edge = (id: string, source: string, target: string, kind: EdgeKind, values = {}) => ({
  id,
  source,
  target,
  kind,
  usage: { source: 'default' as const, values },
  overrides: {},
});
describe('tipos permitidos e inferência (do contrato)', () => {
  it('todo par de contracts/edges.json oferece o tipo dele e infere um tipo permitido', () => {
    for (const { kind, pairs } of edgesFile.kinds) {
      for (const pair of pairs) {
        for (const source of pair.sources) {
          for (const target of pair.targets) {
            const kinds = allowedKinds(source, target);
            expect(kinds, `${source} → ${target}`).toContain(kind);
            expect(kinds).toContain(inferKind(kinds));
          }
        }
      }
    }
  });

  it('runs-on só é oferecida de ECS para EC2', () => {
    const ends = [...BLOCK_TYPES, CLIENT_NODE_ID];
    const offering = BLOCK_TYPES.flatMap((source) =>
      ends
        .filter((target) => allowedKinds(source, target).includes('runs-on'))
        .map((target) => `${source} → ${target}`),
    );
    expect(offering).toEqual(['aws.ecs → aws.ec2']);
  });

  it('ECS para EC2 infere runs-on e oferece também data; o resto infere o único tipo', () => {
    expect(allowedKinds('aws.ecs', 'aws.ec2')).toEqual(['data', 'runs-on']);
    expect(inferKind(allowedKinds('aws.ecs', 'aws.ec2'))).toBe('runs-on');
    expect(inferKind(allowedKinds('aws.lambda', 'aws.cloudwatch'))).toBe('logs');
    expect(inferKind(allowedKinds('aws.s3', CLIENT_NODE_ID))).toBe('data');
    expect(inferKind(allowedKinds('aws.s3', 'aws.cloudwatch'))).toBe('logs');
  });

  it('par fora do contrato não tem tipo', () => {
    expect(allowedKinds('aws.cloudwatch', 'aws.s3')).toEqual([]);
    expect(allowedKinds('aws.lambda', 'aws.nope')).toEqual([]);
    expect(inferKind([])).toBeUndefined();
  });
});

describe('retargetUsage: troca de tipo', () => {
  const edgeWith = (kind: EdgeKind, values: Record<string, number>, overrides = {}) => ({
    ...edge('edg_1', 'a', 'b', kind, values),
    overrides,
  });

  it('data para logs (mesma faixa): mantém uso e override', () => {
    const out = retargetUsage(edgeWith('data', { gbPerMonth: 120 }, { gbPerMonth: 5 }), 'logs');
    expect(out).toEqual({
      usage: { source: 'default', values: { gbPerMonth: 120 } },
      overrides: { gbPerMonth: 5 },
    });
  });

  it('para runs-on (sem gbPerMonth): descarta uso e override', () => {
    const out = retargetUsage(edgeWith('data', { gbPerMonth: 120 }, { gbPerMonth: 5 }), 'runs-on');
    expect(out).toEqual({ usage: { source: 'default', values: {} }, overrides: {} });
  });

  it('de runs-on para data: volta sem valor, e vale o padrão do contrato', () => {
    const out = retargetUsage(edgeWith('runs-on', {}), 'data');
    expect(out.usage.values).toEqual({});
  });

  it('valor fora da faixa do novo tipo é limitado a ela; a origem não muda', () => {
    const out = retargetUsage(edgeWith('data', { gbPerMonth: 5e9 }, { gbPerMonth: -3 }), 'logs');
    expect(out.usage.values.gbPerMonth).toBe(100000000);
    expect(out.overrides.gbPerMonth).toBe(0);
    expect(out.usage.source).toBe('default');
  });
});

describe('aparência por tipo', () => {
  it('cada tipo do contrato tem traçado e legenda próprios', () => {
    const kinds = edgesFile.kinds.map((k) => k.kind as EdgeKind);
    expect(Object.keys(EDGE_STYLE).sort()).toEqual([...kinds].sort());
    expect(new Set(Object.values(EDGE_STYLE).map((s) => s.stroke)).size).toBe(kinds.length);
    expect(new Set(Object.values(EDGE_STYLE).map((s) => s.label)).size).toBe(kinds.length);
  });
});
