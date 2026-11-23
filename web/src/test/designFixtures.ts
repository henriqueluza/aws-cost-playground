import type { DesignDocument } from '../shared/lib/design';

/** Exemplo do ADR-0001, seção "Modelo de dados", copiado literalmente. */
export const adrExampleDesign = {
  schemaVersion: 1,
  region: 'us-east-1',
  workload: { description: 'API REST com 3 milhões de requisições por mês...' },
  blocks: [
    {
      id: 'blk_fn_api',
      type: 'aws.lambda',
      label: 'API handler',
      attributes: { memoryMb: 512, architecture: 'arm64' },
      usage: {
        source: 'llm',
        estimatedAt: '2026-11-18T14:00:00Z',
        values: { requestsPerMonth: 3000000, avgDurationMs: 120 },
      },
      overrides: { avgDurationMs: 80 },
    },
    {
      id: 'blk_assets',
      type: 'aws.s3',
      label: 'Uploads',
      attributes: { storageClass: 'STANDARD' },
      usage: {
        source: 'default',
        values: { storageGb: 50, putRequestsPerMonth: 100000, getRequestsPerMonth: 1000000 },
      },
      overrides: {},
    },
  ],
  edges: [
    {
      id: 'edg_1',
      source: 'blk_assets',
      target: 'client',
      kind: 'data',
      usage: { source: 'llm', values: { gbPerMonth: 120 } },
      overrides: {},
    },
  ],
  scenarios: [],
} satisfies DesignDocument;

/** O exemplo do ADR com `n` cópias do bloco S3, de ids distintos, e sem arestas. */
export const designWithBlocks = (n: number) => ({
  ...adrExampleDesign,
  edges: [],
  blocks: Array.from({ length: n }, (_, i) => ({ ...adrExampleDesign.blocks[1], id: `blk_${i}` })),
});
