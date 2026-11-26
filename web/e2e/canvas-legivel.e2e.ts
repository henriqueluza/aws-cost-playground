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

async function expectLegible(page: Page) {
  const { canvas, legend, tools, nodes, tags } = await boxes(page);
  expect(nodes).toHaveLength(21);
  // 1. todo nó está dentro da área visível do canvas
  expect(nodes.filter((node) => !inside(node, canvas))).toEqual([]);
  // 2. nenhum nó sob a legenda nem sob os controles
  expect(nodes.filter((node) => hit(node, legend) || hit(node, tools))).toEqual([]);
  // 3. nenhum par de etiquetas de aresta se sobrepõe
  const pairs = tags.flatMap((a, i) => tags.slice(i + 1).filter((b) => hit(a, b)));
  expect(pairs).toEqual([]);
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

test('ao redimensionar a janela de 1440 para 1024 o diagrama continua inteiro', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expectLegible(page);
  await page.setViewportSize({ width: 1024, height: 768 });
  await expectLegible(page);
});
