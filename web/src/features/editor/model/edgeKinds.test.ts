import { describe, expect, it } from 'vitest';
import edgesFile from '../../../../../contracts/edges.json';
import { CLIENT_NODE_ID, designDocumentSchema, type EdgeKind } from '../../../shared/lib/design';
import { adrExampleDesign } from '../../../test/designFixtures';
import { BLOCK_TYPES } from '../../pricing';
import {
  allowedKinds,
  connectTargets,
  edgeCostNote,
  EDGE_STYLE,
  inferKind,
  retargetUsage,
} from './edgeKinds';

const base = designDocumentSchema.parse(adrExampleDesign);
const block = (id: string, type: string, attributes = {}) => ({
  ...base.blocks[1]!,
  id,
  type,
  label: id,
  attributes,
});
const edge = (id: string, source: string, target: string, kind: EdgeKind, values = {}) => ({
  id,
  source,
  target,
  kind,
  usage: { source: 'default' as const, values },
  overrides: {},
});
const docOf = (blocks: ReturnType<typeof block>[], edges: ReturnType<typeof edge>[]) => ({
  ...base,
  blocks,
  edges,
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

describe('edgeCostNote: custa ou não, pelas regras do motor', () => {
  const doc = docOf(
    [
      block('s3', 'aws.s3'),
      block('cf', 'aws.cloudfront'),
      block('nat', 'aws.nat-gateway'),
      block('fn', 'aws.lambda'),
      block('logs', 'aws.cloudwatch'),
      block('ecs', 'aws.ecs'),
      block('ec2', 'aws.ec2'),
    ],
    [],
  );
  const note = (source: string, target: string, kind: EdgeKind) =>
    edgeCostNote(doc, edge('edg_x', source, target, kind));

  it.each([
    ['s3', CLIENT_NODE_ID, 'data', /internet/],
    ['cf', CLIENT_NODE_ID, 'data', /CloudFront/],
    ['fn', 'nat', 'data', /NAT/],
    ['fn', 'logs', 'logs', /logs/],
  ] as const)('%s → %s (%s) custa', (source, target, kind, text) => {
    const result = note(source, target, kind);
    expect(result.costs).toBe(true);
    expect(result.text).toMatch(/^Custa: /);
    expect(result.text).toMatch(text);
  });

  it('runs-on não custa e aponta o EC2', () => {
    expect(note('ecs', 'ec2', 'runs-on')).toEqual({
      costs: false,
      text: 'Não custa aqui: o custo do ECS está no EC2 que o executa.',
    });
  });

  it('data comum não custa; par fora do contrato fica fora da estimativa', () => {
    expect(note('fn', 's3', 'data').costs).toBe(false);
    const outside = note('logs', 's3', 'data');
    expect(outside.costs).toBe(false);
    expect(outside.text).toMatch(/fora da estimativa/);
  });
});

describe('connectTargets: destinos de "Conectar a…"', () => {
  const doc = docOf(
    [block('fn', 'aws.lambda'), block('s3', 'aws.s3'), block('logs', 'aws.cloudwatch')],
    [edge('edg_1', 'fn', 's3', 'data')],
  );

  it('só lista o que o contrato permite, sem os já ligados e sem o próprio bloco', () => {
    const targets = connectTargets(doc, 'fn');
    expect(targets.map((t) => t.id)).toEqual(['logs']);
    expect(targets[0]).toMatchObject({ kind: 'logs', kinds: ['logs'] });
  });

  it('inclui a Internet quando o contrato permite e dá os tipos do par', () => {
    const only = docOf([block('s3', 'aws.s3'), block('ec2', 'aws.ec2')], []);
    const ids = connectTargets(only, 's3').map((t) => t.id);
    expect(ids).toContain(CLIENT_NODE_ID);
    const ecs = docOf([block('ecs', 'aws.ecs'), block('ec2', 'aws.ec2')], []);
    const host = connectTargets(ecs, 'ecs').find((t) => t.id === 'ec2');
    expect(host).toMatchObject({ kind: 'runs-on', kinds: ['data', 'runs-on'] });
  });

  it('o client e bloco inexistente não são origem', () => {
    expect(connectTargets(doc, CLIENT_NODE_ID)).toEqual([]);
    expect(connectTargets(doc, 'nada')).toEqual([]);
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
