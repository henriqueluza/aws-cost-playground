import { expect, test } from '@playwright/test';
import { useSiteConfig } from './support/siteConfig';

test.beforeEach(useSiteConfig);

/** Um design mínimo e válido: uma instância EC2 e a região. */
const design = {
  schemaVersion: 1,
  region: 'us-east-1',
  workload: { description: '' },
  blocks: [
    {
      id: 'blk_web',
      type: 'aws.ec2',
      label: 'Web',
      attributes: { instanceType: 't3.small' },
      usage: { source: 'default', values: { instanceCount: 1 } },
      overrides: {},
    },
  ],
  edges: [],
  scenarios: [],
};

test('o painel Exportar baixa o main.tf do design aberto', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'design.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(design)),
  });
  await page.getByRole('tab', { name: 'Exportar' }).click();

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar Terraform' }).click();
  const file = await download;

  expect(file.suggestedFilename()).toBe('main.tf');
  const stream = await file.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString('utf-8');
  expect(text).toContain('resource "aws_instance"');
});
