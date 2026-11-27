import { describe, expect, it } from 'vitest';
import { designDocumentSchema, type DesignDocument } from '../../../shared/lib/design';
import scenarioApi from '../../../../../contracts/scenarios/api-serverless.json';
import scenarioApp from '../../../../../contracts/scenarios/app-classico.json';
import scenarioPipeline from '../../../../../contracts/scenarios/pipeline-de-filas.json';
import { referenceDesign } from './template/referenceTemplate';
import { COLUMN_PITCH, defaultLayout, ROW_PITCH } from './defaultLayout';

const scenarios = [
  ['api-serverless', designDocumentSchema.parse(scenarioApi)],
  ['app-classico', designDocumentSchema.parse(scenarioApp)],
  ['pipeline-de-filas', designDocumentSchema.parse(scenarioPipeline)],
] as const;

/** Largura do diagrama, de borda a borda dos blocos (216 px). */
const widthOf = (doc: DesignDocument) =>
  Math.max(...Object.values(defaultLayout(doc)).map((p) => p.x)) + 216;

describe('defaultLayout', () => {
  it('é determinístico', () => {
    for (const [, doc] of scenarios) expect(defaultLayout(doc)).toEqual(defaultLayout(doc));
  });

  it.each(scenarios)(
    'em %s, o fluxo vai da esquerda para a direita (sem aresta para trás)',
    (_n, doc) => {
      const at = defaultLayout(doc);
      for (const edge of doc.edges) {
        expect(at[edge.target]!.x).toBeGreaterThan(at[edge.source]!.x);
      }
    },
  );

  it.each(scenarios)('em %s, nenhum par de nós ocupa a mesma célula', (_n, doc) => {
    const cells = Object.values(defaultLayout(doc)).map((p) => `${p.x},${p.y}`);
    expect(new Set(cells).size).toBe(cells.length);
  });

  it('os corredores têm 52 px entre colunas de blocos de 216 px', () => {
    expect(COLUMN_PITCH - 216).toBe(52);
  });

  it('o cenário de quatro colunas cabe em 1020 px; os de cinco, em 1288 px', () => {
    const [api, app, pipeline] = scenarios.map(([, doc]) => widthOf(doc));
    expect(api).toBeLessThanOrEqual(1020);
    expect(app).toBeLessThanOrEqual(1288);
    expect(pipeline).toBeLessThanOrEqual(1288);
  });

  it('põe o client logo depois da sua origem mais funda, não na última coluna', () => {
    const [, app] = scenarios[1];
    const at = defaultLayout(app);
    const assets = at.blk_assets!;
    expect(at.client!.x).toBe(assets.x + COLUMN_PITCH);
    expect(Math.max(...Object.values(at).map((p) => p.x))).toBeGreaterThan(at.client!.x);
  });

  it('o client sem arestas não abre uma coluna nova', () => {
    const [, pipeline] = scenarios[2];
    const at = defaultLayout(pipeline);
    const blocks = Object.entries(at).filter(([id]) => id !== 'client');
    expect(at.client!.x).toBe(Math.max(...blocks.map(([, p]) => p.x)));
  });

  it('as linhas são juntas (104 px) e começam em 0', () => {
    expect(ROW_PITCH).toBe(104);
    const ys = Object.values(defaultLayout(designDocumentSchema.parse(scenarioApp))).map(
      (p) => p.y,
    );
    expect(Math.min(...ys)).toBe(0);
    expect(ys.every((y) => y % ROW_PITCH === 0)).toBe(true);
  });

  it('quem só recebe logs vai uma coluna depois da sua origem mais funda', () => {
    const [, app] = scenarios[1];
    const at = defaultLayout(app);
    expect(at.blk_logs!.x).toBeGreaterThan(at.blk_db!.x);
  });

  it('ordena a coluna pela média das linhas das origens (menos cruzamentos)', () => {
    const [, app] = scenarios[1];
    const at = defaultLayout(app);
    // web_a e web_b vêm do ALB: ficam na ordem do design, uma linha depois da outra
    expect(at.blk_web_b!.y - at.blk_web_a!.y).toBe(ROW_PITCH);
  });

  it('o template sem posições fica mais estreito que no layout antigo (1456 px)', () => {
    expect(widthOf(referenceDesign())).toBeLessThan(1456);
    expect(widthOf(referenceDesign())).toBeLessThanOrEqual(1288);
  });

  it('um design vazio só tem o client, na origem', () => {
    const [, empty] = [0, { ...designDocumentSchema.parse(scenarioApi), blocks: [], edges: [] }];
    expect(defaultLayout(empty)).toEqual({ client: { x: 0, y: 0 } });
  });
});
