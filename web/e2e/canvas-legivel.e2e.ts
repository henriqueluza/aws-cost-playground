import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const hit = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const inside = (a: Box, c: Box) =>
  a.x >= c.x - 0.5 &&
  a.y >= c.y - 0.5 &&
  a.x + a.width <= c.x + c.width + 0.5 &&
  a.y + a.height <= c.y + c.height + 0.5;

/** Retângulos, na tela, do canvas, dos nós, da legenda, dos controles e das etiquetas visíveis. */
async function boxes(page: Page) {
  await page.waitForSelector('.react-flow__node');
  await page.waitForTimeout(500); // o ajuste espera os nós serem medidos
  return page.evaluate(() => {
    const box = (el: Element): Box => {
      const { x, y, width, height } = el.getBoundingClientRect();
      return { x, y, width, height };
    };
    const one = (selector: string) => box(document.querySelector(selector)!);
    return {
      canvas: one('.react-flow'),
      legend: one('[aria-label="Legenda das conexões"]'),
      tools: one('[aria-label="Zoom do diagrama"]'),
      nodes: [...document.querySelectorAll('.react-flow__node')].map(box),
      tags: [...document.querySelectorAll('.react-flow__edgelabel-renderer span')]
        .filter((tag) => getComputedStyle(tag).display !== 'none')
        .map(box),
    };
  });
}

/** Corpo do nome de cada bloco na tela, em px: o font-size computado vezes o zoom do viewport. */
async function nameBodies(page: Page) {
  return page.evaluate(() => {
    const zoom = new DOMMatrix(
      getComputedStyle(document.querySelector('.react-flow__viewport')!).transform,
    ).a;
    const names = [...document.querySelectorAll('.react-flow__node [class*="name"]')];
    const blocks = [...document.querySelectorAll('.react-flow__node')].map(
      (n) => n.firstElementChild!,
    );
    return {
      zoom,
      bodies: names.map((name) => parseFloat(getComputedStyle(name).fontSize) * zoom),
      // o texto ampliado cabe no bloco: nada passa da caixa
      overflowing: blocks.filter(
        (b) => b.scrollHeight > b.clientHeight + 1 || b.scrollWidth > b.clientWidth + 1,
      ).length,
    };
  });
}

/** Abaixo de 9px na tela o nome não se lê (critério da #342). */
const MIN_BODY = 9;

async function expectLegible(page: Page, nodeCount = 21) {
  const { canvas, legend, tools, nodes, tags } = await boxes(page);
  expect(nodes).toHaveLength(nodeCount);
  // 1. todo nó está dentro da área visível do canvas
  expect(nodes.filter((node) => !inside(node, canvas))).toEqual([]);
  // 2. nenhum nó sob a legenda nem sob os controles
  expect(nodes.filter((node) => hit(node, legend) || hit(node, tools))).toEqual([]);
  // 3. nenhum par de etiquetas de aresta se sobrepõe
  const pairs = tags.flatMap((a, i) => tags.slice(i + 1).filter((b) => hit(a, b)));
  expect(pairs).toEqual([]);
  // 4. o nome de cada bloco se lê, e o texto ampliado não estoura o bloco
  const { bodies, overflowing } = await nameBodies(page);
  expect(bodies).toHaveLength(nodeCount);
  expect(Math.min(...bodies)).toBeGreaterThanOrEqual(MIN_BODY);
  expect(overflowing).toBe(0);
}

for (const [width, height] of [
  [1440, 900],
  [1024, 768],
] as const) {
  test(`o template abre inteiro, sem nó sob a legenda e sem etiquetas sobrepostas em ${width}x${height}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/');
    await expectLegible(page);
  });
}

for (const [width, height, minimum] of [
  [1920, 1080, 10.5],
  [1440, 900, 10],
  [1024, 768, 10],
] as const) {
  test(`o corpo do nome do bloco na tela é de pelo menos ${minimum}px em ${width}x${height}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/');
    await boxes(page);
    const { bodies } = await nameBodies(page);
    expect(Math.min(...bodies)).toBeGreaterThanOrEqual(minimum);
  });
}

test('em 1024 a paleta abre recolhida e, expandida, o diagrama continua inteiro e legível', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/');
  await expectLegible(page);
  await expect(page.getByRole('heading', { name: 'Paleta' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Mostrar a paleta' }).click();
  await expect(page.getByRole('button', { name: 'Recolher a paleta' })).toBeFocused();
  await expectLegible(page);
  await page.getByRole('button', { name: 'Recolher a paleta' }).click();
  await expect(page.getByRole('button', { name: 'Mostrar a paleta' })).toBeFocused();
  await expectLegible(page);
});

test('ao aproximar o zoom o bloco volta ao completo, com o SKU e "por mês", e o nome acessível não muda', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await boxes(page);
  const canvas = page.locator('[data-detail]').first();
  const label = await page.locator('.react-flow__node[data-id]').nth(1).getAttribute('aria-label');
  await expect(canvas).toHaveAttribute('data-detail', 'compact');
  await expect(page.getByText('por mês').first()).toBeHidden();
  for (let i = 0; i < 4; i += 1)
    await page.getByRole('button', { name: 'Aumentar o zoom' }).click();
  await expect(canvas).toHaveAttribute('data-detail', 'full');
  await expect(page.getByText('por mês').first()).toBeVisible();
  expect(await page.locator('.react-flow__node[data-id]').nth(1).getAttribute('aria-label')).toBe(
    label,
  );
});

test('ao redimensionar a janela de 1440 para 1024 o diagrama continua inteiro', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expectLegible(page);
  await page.setViewportSize({ width: 1024, height: 768 });
  await expectLegible(page);
});

const SCENARIOS = [
  ['api-serverless', 6],
  ['app-classico', 10],
  ['pipeline-de-filas', 9],
] as const;

for (const theme of ['light', 'dark'] as const) {
  test(`${theme}: os cenários abrem inteiros, centralizados e sem etiquetas sobrepostas, e Novo design volta ao template`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto('/');
    await expectLegible(page);
    for (const [name, count] of SCENARIOS) {
      await page.locator('input[type="file"]').setInputFiles({
        name: `${name}.json`,
        mimeType: 'application/json',
        buffer: readFileSync(`../contracts/scenarios/${name}.json`),
      });
      const replace = page.getByRole('button', { name: 'Substituir design' });
      if (await replace.isVisible().catch(() => false)) await replace.click();
      await expectLegible(page, count);
      // centralizado na horizontal: as folgas à esquerda e à direita diferem em poucos px
      const { canvas, nodes } = await boxes(page);
      const left = Math.min(...nodes.map((n) => n.x)) - canvas.x;
      const right = canvas.x + canvas.width - Math.max(...nodes.map((n) => n.x + n.width));
      expect(Math.abs(left - right)).toBeLessThanOrEqual(4);
    }
    await page.getByRole('button', { name: 'Novo design' }).click();
    await expectLegible(page);
  });
}
