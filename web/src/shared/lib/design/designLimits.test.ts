// @vitest-environment node
import { describe, expect, it } from 'vitest';
import apiServerless from '../../../../../contracts/scenarios/api-serverless.json';
import appClassico from '../../../../../contracts/scenarios/app-classico.json';
import pipelineDeFilas from '../../../../../contracts/scenarios/pipeline-de-filas.json';
import referenceTemplate from '../../../../../contracts/templates/reference.json';
import { MAX_DESIGNS } from '../api';
import { DESIGN_LIMITS, designDocumentSchema } from './designDocument';

/** Bytes UTF-8 do documento serializado: a mesma medida do fake e da API (`doc_size_bytes`). */
const size = (doc: unknown) => new TextEncoder().encode(JSON.stringify(doc)).length;
/** Descrição e rótulos no limite de caracteres, com o caractere mais caro em UTF-8 (3 bytes). */
const worstText = (raw: unknown) => {
  const doc = designDocumentSchema.parse(raw);
  return designDocumentSchema.parse({
    ...doc,
    workload: { description: '日'.repeat(DESIGN_LIMITS.maxDescriptionLength) },
    blocks: doc.blocks.map((block) => ({
      ...block,
      label: '日'.repeat(DESIGN_LIMITS.maxLabelLength),
    })),
  });
};

describe('limites de designs (#386)', () => {
  it('são os da API: 10 designs de até 100.000 bytes', () => {
    expect(MAX_DESIGNS).toBe(10);
    expect(DESIGN_LIMITS.maxDocBytes).toBe(100_000);
  });

  it('o template de 20 blocos mede o mesmo que na API e cabe mais de 12 vezes', () => {
    const template = designDocumentSchema.parse(referenceTemplate);
    expect(template.blocks).toHaveLength(20);
    expect(size(template)).toBe(7_987);
    expect(size(template) * 12).toBeLessThanOrEqual(DESIGN_LIMITS.maxDocBytes);
  });

  it.each([
    ['template', referenceTemplate],
    ['api-serverless', apiServerless],
    ['app-classico', appClassico],
    ['pipeline-de-filas', pipelineDeFilas],
  ])('%s cabe com o dobro de folga mesmo com descrição e rótulos no limite', (_name, raw) => {
    expect(size(worstText(raw)) * 2).toBeLessThanOrEqual(DESIGN_LIMITS.maxDocBytes);
  });
});
