// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import apiServerless from '../../../../../contracts/scenarios/api-serverless.json';
import appClassico from '../../../../../contracts/scenarios/app-classico.json';
import pipelineDeFilas from '../../../../../contracts/scenarios/pipeline-de-filas.json';
import { designDocumentSchema } from '../../../shared/lib/design';
import { sum, toFixed } from '../../../shared/lib/money';
import { estimate, priceFileSchema, type PriceCatalog } from '..';
import { catalogServices } from './catalogServices';

const directory = resolve(import.meta.dirname, '../../../../public/prices/us-east-1');
const files = readdirSync(directory)
  .filter((name) => name.endsWith('.json'))
  .map((name) => priceFileSchema.parse(JSON.parse(readFileSync(resolve(directory, name), 'utf8'))));
/** As sementes versionadas de us-east-1, todas, como o motor as recebe. */
const seed: PriceCatalog = {
  region: 'us-east-1',
  manifest: { schemaVersion: 1, source: 'seed', generatedAt: '2026-11-23T12:00:00Z', files: [] },
  services: new Map(files.map((file) => [file.service, file])),
};
const inSeed = (service: string, sku: string) =>
  seed.services.get(service)?.prices.some((price) => price.sku === sku) ?? false;

const INTERNET = ['data-transfer', 'data-transfer-internet-out'] as const;
const CLOUDFRONT = ['cloudfront', 'cloudfront-data-transfer-out'] as const;
const INTER_AZ = ['data-transfer', 'data-transfer-inter-az'] as const;
const NAT = ['nat-gateway', 'nat-gateway-data-processed'] as const;
const LOGS = ['cloudwatch', 'cloudwatch-logs-ingestion'] as const;

/**
 * As arestas que custam em cada cenário (`docs/scenarios.md`), com o serviço e o SKU do catálogo
 * e o volume bruto em GB. Lista escrita à mão: não deriva do motor. O que não está aqui não custa.
 */
const scenarios = [
  {
    name: 'api-serverless',
    design: apiServerless,
    paid: { edg_cdn_client: [...CLOUDFRONT, 300], edg_api_logs: [...LOGS, 20] },
  },
  {
    name: 'app-classico',
    design: appClassico,
    paid: {
      edg_cdn_client: [...CLOUDFRONT, 500],
      edg_assets_client: [...INTERNET, 50],
      // Entre zonas: o volume da aresta nas duas direções.
      edg_web_b_db: [...INTER_AZ, 60],
      edg_web_b_cache: [...INTER_AZ, 20],
      edg_web_a_nat: [...NAT, 25],
      edg_web_b_nat: [...NAT, 25],
      edg_web_a_logs: [...LOGS, 15],
      edg_web_b_logs: [...LOGS, 15],
      edg_db_logs: [...LOGS, 10],
    },
  },
  {
    name: 'pipeline-de-filas',
    design: pipelineDeFilas,
    paid: { edg_splitter_logs: [...LOGS, 5], edg_worker_logs: [...LOGS, 35] },
  },
] as const;

describe('custos de aresta dos cenários de referência com as sementes versionadas', () => {
  it('a semente de transferência de dados e a de saída do CloudFront existem', () => {
    for (const [service, sku] of [INTERNET, INTER_AZ, CLOUDFRONT]) {
      expect(inSeed(service, sku), `${service}/${sku}`).toBe(true);
    }
  });

  it.each(scenarios)('$name: toda aresta que custa tem preço', ({ design, paid }) => {
    const document = designDocumentSchema.parse(design);
    const result = estimate(document, seed);
    const expected: Record<string, readonly [string, string, number]> = paid;
    for (const edge of result.edges) {
      const charge = expected[edge.edgeId];
      if (charge === undefined) {
        // Aresta que não custa: `priced`, zero, sem linhas.
        expect([edge.edgeId, edge.status, edge.lines.length]).toEqual([edge.edgeId, 'priced', 0]);
        continue;
      }
      const [service, sku, grossGb] = charge;
      expect(catalogServices(document), edge.edgeId).toContain(service);
      // As sementes de `cloudwatch` (#37) e `nat-gateway` (#36) chegam por outros PRs: enquanto
      // o SKU não estiver na semente a aresta sai `unavailable`; quando chegar, passa a valer a
      // exigência de preço, sem editar este teste.
      if (!inSeed(service, sku)) {
        expect([edge.edgeId, edge.status]).toEqual([edge.edgeId, 'unavailable']);
        continue;
      }
      expect([edge.edgeId, edge.status]).toEqual([edge.edgeId, 'priced']);
      expect(edge.lines.map((line) => line.sku)).toEqual(edge.lines.map(() => sku));
      // Cobrado = bruto menos a franquia que a aresta usou: nunca mais que o bruto, e igual a ele
      // onde o SKU não tem franquia.
      const billed = Number(toFixed(sum(edge.lines.map((line) => line.quantity)), 6));
      const free = seed.services.get(service)?.prices.find((p) => p.sku === sku)?.freeTier;
      if (free === undefined) expect(billed, edge.edgeId).toBe(grossGb);
      else expect(billed, edge.edgeId).toBeLessThanOrEqual(grossGb);
      expect(edge.total, edge.edgeId).toBe(sum(edge.lines.map((line) => line.amount)));
    }
    expect(
      Object.keys(expected).filter((id) => !result.edges.some((e) => e.edgeId === id)),
    ).toEqual([]);
  });
});
