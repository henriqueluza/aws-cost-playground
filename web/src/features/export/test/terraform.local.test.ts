// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import apiServerless from '../../../../../contracts/scenarios/api-serverless.json';
import appClassico from '../../../../../contracts/scenarios/app-classico.json';
import pipelineDeFilas from '../../../../../contracts/scenarios/pipeline-de-filas.json';
import { adrExampleDesign } from '../../../test/designFixtures';
import { exportDesign } from '../application/exportDesign';
import { hcl, renderHcl } from '../model/hcl';
import { design, relabel } from './generatorHarness';
import { INJECTION_PAYLOADS } from './injectionPayloads';

/**
 * Conferência local e opcional com o binário `terraform` (não roda no CI nem no `npm test`):
 *   EXPORT_TERRAFORM_CHECK=1 npx vitest run src/features/export/test/terraform.local.test.ts
 * O arquivo só tem `locals` e `output`, então não baixa provider nem usa credencial. A validação
 * do export inteiro, com o provider da AWS, é o job da #68.
 */
const enabled = process.env.EXPORT_TERRAFORM_CHECK === '1';
/** Com `EXPORT_TERRAFORM_AWS=1` também valida o export dos cenários com o provider da AWS (baixa o plugin). */
const withAws = enabled && process.env.EXPORT_TERRAFORM_AWS === '1';
/** Só os blocos sem VPC (#65): as arestas que viram referência e um de cada sem aresta. */
const serverlessOnly = design(
  [
    { id: 'cdn', type: 'aws.cloudfront' },
    { id: 'site', type: 'aws.s3' },
    { id: 'queue', type: 'aws.sqs', attributes: { queueType: 'fifo' } },
    { id: 'worker', type: 'aws.lambda', label: 'x'.repeat(80) },
    { id: 'table', type: 'aws.dynamodb', attributes: { capacityMode: 'provisioned' } },
    { id: 'archive', type: 'aws.s3', attributes: { storageClass: 'STANDARD_IA' } },
    { id: 'lone_cdn', type: 'aws.cloudfront', label: 'y'.repeat(80) },
    { id: 'lone_fn', type: 'aws.lambda' },
  ],
  [
    ['cdn', 'site'],
    ['cdn', 'client'],
    ['queue', 'worker'],
    ['worker', 'queue'],
    ['worker', 'table'],
    ['worker', 'archive'],
    ['archive', 'worker'],
  ],
);
const SCENARIOS = {
  apiServerless,
  appClassico,
  pipelineDeFilas,
  serverlessOnly,
  pipelineComRotulosHostis: relabel(pipelineDeFilas, INJECTION_PAYLOADS[0]?.[1] ?? ''),
  apiComInterpolacaoNosRotulos: relabel(apiServerless, INJECTION_PAYLOADS[1]?.[1] ?? ''),
};

describe.skipIf(!enabled)('conferência com o binário terraform', { timeout: 120_000 }, () => {
  it('as cargas de injeção viram HCL bem formado e voltam com o mesmo valor', () => {
    const dir = mkdtempSync(join(tmpdir(), 'acp-export-'));
    const terraform = (args: string[], input?: string) =>
      execFileSync('terraform', args, { cwd: dir, input, encoding: 'utf8' });
    try {
      const payloads = INJECTION_PAYLOADS.map(([, payload]) => payload);
      const file = renderHcl([
        ...payloads.map((payload) => hcl.comment(payload)),
        hcl.block(
          'locals',
          [],
          payloads.map((payload, i) => hcl.attr(`v${i}`, hcl.string(payload))),
        ),
        hcl.block(
          'output',
          ['all'],
          [hcl.attr('value', hcl.list(payloads.map((_, i) => hcl.ref('local', `v${i}`))))],
        ),
      ]);
      writeFileSync(join(dir, 'main.tf'), file);
      // Chaves de largura irregular (emoji) ficam fora do `fmt -check`: só a validade importa.
      const keys = hcl.map(Object.fromEntries(payloads.map((p, i) => [p, hcl.number(i)])));
      writeFileSync(
        join(dir, 'keys.tf'),
        renderHcl([hcl.block('locals', [], [hcl.attr('keys', keys)])]),
      );

      // O export inteiro, com as cargas nos rótulos: o `fmt` lê a sintaxe sem precisar do provider.
      const blocks = payloads.map((payload, i) => ({
        ...adrExampleDesign.blocks[1],
        id: `blk_${i}`,
        label: payload.slice(0, 80),
      }));
      const exported = exportDesign({ ...adrExampleDesign, blocks, edges: [] });
      if (!exported.ok) throw new Error(exported.error);
      terraform(['fmt', '-check', '-'], exported.files[0]?.content);

      terraform(['fmt', '-check', 'main.tf']);
      terraform(['init', '-backend=false', '-input=false']);
      expect(terraform(['validate', '-no-color'])).toContain('Success');

      // O console lê uma expressão por execução; base64 evita depender do escape da resposta.
      const ask = (expression: string) => terraform(['console'], `${expression}\n`).trim();
      const all = payloads.map((_, i) => `local.v${i}`).join(', ');
      const decoded = ask(`join(",", [for v in [${all}] : base64encode(v)])`)
        .replaceAll('"', '')
        .split(',')
        .map((item) => Buffer.from(item, 'base64').toString('utf8'));
      // Surrogate solto não existe em UTF-8: o gerador o troca por U+FFFD, como o TextEncoder.
      expect(decoded).toEqual(
        payloads.map((p) =>
          new TextDecoder('utf-8', { ignoreBOM: true }).decode(new TextEncoder().encode(p)),
        ),
      );
      expect(ask('length(local.keys)')).toBe(String(new Set(payloads).size));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(!withAws).each(Object.entries(SCENARIOS))(
    'o export do cenário %s passa no validate com o provider da AWS',
    (_name, scenario) => {
      const dir = mkdtempSync(join(tmpdir(), 'acp-export-aws-'));
      const terraform = (args: string[]) =>
        execFileSync('terraform', args, { cwd: dir, encoding: 'utf8' });
      try {
        const exported = exportDesign(scenario);
        if (!exported.ok) throw new Error(exported.error);
        writeFileSync(join(dir, 'main.tf'), exported.files[0]?.content ?? '');
        terraform(['fmt', '-check', 'main.tf']);
        terraform(['init', '-backend=false', '-input=false']);
        expect(terraform(['validate', '-no-color'])).toContain('Success');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});
