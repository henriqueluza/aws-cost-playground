// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REGIONS, type Region } from '../../../../shared/lib/design';
import { toFixed } from '../../../../shared/lib/money';
import { estimate, priceFileSchema, type PriceCatalog } from '../../../pricing';
import { referenceDesign } from './referenceTemplate';

/** As sementes versionadas de uma região, todas, como o motor as recebe. */
function seedOf(region: Region): PriceCatalog {
  const directory = resolve(import.meta.dirname, `../../../../../public/prices/${region}`);
  const files = readdirSync(directory)
    .filter((name) => name.endsWith('.json'))
    .map((name) =>
      priceFileSchema.parse(JSON.parse(readFileSync(resolve(directory, name), 'utf8'))),
    );
  return {
    region,
    manifest: { schemaVersion: 1, source: 'seed', generatedAt: '2026-11-23T12:00:00Z', files: [] },
    services: new Map(files.map((file) => [file.service, file])),
  };
}

describe.each(REGIONS)('template inicial com as sementes de %s e o motor real', (region) => {
  const seed = seedOf(region);
  const result = estimate({ ...referenceDesign(), region }, seed);
  /** Serviço cuja semente ainda não chegou (arquivo ausente ou `prices: []`): único motivo aceito. */
  const pending = (type: string) =>
    (seed.services.get(type.replace(/^aws\./, ''))?.prices.length ?? 0) === 0;

  it('abre com total diferente de zero', () => {
    expect(Number(toFixed(result.total, 2))).toBeGreaterThan(0);
    expect(Number(toFixed(result.total, 2))).toBeCloseTo(
      Number(toFixed(result.fixed, 2)) + Number(toFixed(result.variable, 2)),
      1,
    );
  });

  it('nenhum bloco ou aresta sai sem preço, salvo serviço sem semente', () => {
    const design = referenceDesign();
    const typeOf = new Map(design.blocks.map((block) => [block.id, block.type]));
    const blocks = result.blocks.filter((cost) => cost.status === 'unavailable');
    expect(blocks.filter((cost) => !pending(cost.blockType))).toEqual([]);
    const edges = result.edges.filter((cost) => cost.status === 'unavailable');
    // A aresta de logs depende do CloudWatch e a de saída, de `data-transfer`; o que falta é por semente.
    expect(
      edges.filter((cost) => {
        const edge = design.edges.find((e) => e.id === cost.edgeId);
        return edge?.kind !== 'logs' || !pending(typeOf.get(edge.target) ?? 'aws.cloudwatch');
      }),
    ).toEqual([]);
  });
});
