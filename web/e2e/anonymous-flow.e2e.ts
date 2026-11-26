import { expect, test, type Page } from '@playwright/test';
import { expectNoSeriousA11yViolations } from './support/axe';
import { watchForeignRequests } from './support/network';

/** Total do template em us-east-1 com o catálogo versionado em `public/prices`. */
const TEMPLATE_TOTAL = 'US$ 131,28';
const ZERO_TOTAL = 'US$ 0,00';

test.use({ viewport: { width: 1440, height: 900 } });

const totalLine = (page: Page) =>
  page.getByRole('region', { name: 'Preço' }).getByRole('paragraph').filter({ hasText: '/mês' });

/** Lê o total da tela ("US$ 131,28"), sem o "/mês". */
async function readTotal(page: Page): Promise<string> {
  const text = await totalLine(page).innerText();
  const amount = /US\$\s[\d.,]+/.exec(text)?.[0];
  if (amount === undefined) throw new Error(`Total fora do formato esperado: ${text}`);
  return amount.replace(/\s/, ' ');
}

/** Espera o total deixar de ser `previous` e devolve o novo. */
async function readChangedTotal(page: Page, previous: string): Promise<string> {
  await expect(totalLine(page)).not.toContainText(previous);
  return readTotal(page);
}

test('fluxo anônimo: template, edição, baixar e abrir, sem tocar a API', async ({
  page,
  baseURL,
}, testInfo) => {
  if (baseURL === undefined) throw new Error('baseURL não configurada');
  const foreignRequests = watchForeignRequests(page, baseURL);
  const diagram = page.getByRole('application', { name: 'Diagrama da arquitetura' });
  const blocks = diagram.getByRole('group', { name: /por mês/ });
  // Aresta: "Dados: ALB para ECS". O nó fixo da Internet também tem "para" no nome, sem os dois-pontos.
  const edges = diagram.getByRole('group', { name: /: .+ para / });

  await test.step('abrir o site mostra o template com total diferente de zero', async () => {
    await page.goto('/');
    await expect(totalLine(page)).toContainText(TEMPLATE_TOTAL);
    expect(await readTotal(page)).not.toBe(ZERO_TOTAL);
    await expectNoSeriousA11yViolations(page, 'editor inicial');
  });
  await expect(blocks).not.toHaveCount(0);
  await expect(edges).not.toHaveCount(0);
  const templateBlocks = await blocks.count();
  const templateEdges = await edges.count();

  await test.step('adicionar um bloco pela paleta, pelo teclado', async () => {
    const item = page
      .getByRole('complementary', { name: 'Paleta' })
      .getByRole('button', { name: 'S3', exact: true });
    await item.focus();
    await page.keyboard.press('Enter');
    await expect(blocks).toHaveCount(templateBlocks + 1);
  });
  const totalWithBlock = await readChangedTotal(page, TEMPLATE_TOTAL);

  await test.step('selecionar o bloco novo e conectá-lo por "Conectar a…"', async () => {
    // O bloco novo leva o nome do tipo ("S3, S3, …"); o do template é "S3, Arquivos estáticos, …".
    await diagram.getByRole('group', { name: /^S3, S3,/ }).focus();
    await page.keyboard.press('Enter');
    await page.getByRole('tab', { name: 'Bloco' }).click();
    const connect = page.getByRole('region', { name: 'Conectar a…' });
    await connect.getByRole('combobox', { name: 'Destino' }).selectOption({
      label: 'Lambda, Tarefas assíncronas',
    });
    await connect.getByRole('button', { name: 'Conectar' }).click();
    await expect(edges).toHaveCount(templateEdges + 1);
    await expectNoSeriousA11yViolations(page, 'inspetor de bloco');
  });

  const editedTotal = await test.step('editar um valor de uso muda o total', async () => {
    // O total fica na aba Custo; o campo, na aba Bloco (a seleção se mantém entre as abas).
    await page.getByRole('tab', { name: 'Custo' }).click();
    const before = await readTotal(page);
    await page.getByRole('tab', { name: 'Bloco' }).click();
    const storage = page.getByRole('textbox', { name: 'Armazenamento' });
    await storage.fill('5000');
    await storage.press('Enter');
    await page.getByRole('tab', { name: 'Custo' }).click();
    const after = await readChangedTotal(page, before);
    expect([TEMPLATE_TOTAL, totalWithBlock]).not.toContain(after);
    return after;
  });

  await test.step('"Novo design" com alteração pendente pede confirmação', async () => {
    await page.getByRole('button', { name: 'Novo design' }).click();
    const dialog = page.getByRole('dialog', { name: 'Descartar as alterações?' });
    await expect(dialog).toBeVisible();
    await expectNoSeriousA11yViolations(page, 'diálogo de confirmação');
    await dialog.getByRole('button', { name: 'Cancelar' }).click();
    await expect(dialog).toBeHidden();
    await expect(totalLine(page)).toContainText(editedTotal);
  });

  const file = testInfo.outputPath('design.json');
  await test.step('baixar o design', async () => {
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Baixar JSON' }).click();
    await (await download).saveAs(file);
  });

  await test.step('novo design volta ao template', async () => {
    await page.getByRole('button', { name: 'Novo design' }).click();
    // Baixar guarda o design, então hoje não há pergunta; se houver, o descarte é confirmado.
    const discard = page.getByRole('button', { name: 'Descartar e criar novo design' });
    const template = totalLine(page).filter({ hasText: TEMPLATE_TOTAL });
    await expect(discard.or(template)).toBeVisible();
    if (await discard.isVisible()) await discard.click();
    await expect(template).toBeVisible();
    await expect(blocks).toHaveCount(templateBlocks);
  });

  await test.step('abrir o arquivo baixado restaura o mesmo total', async () => {
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Abrir arquivo' }).click();
    await (await chooser).setFiles(file);
    await expect(totalLine(page)).toContainText(editedTotal);
    expect(await readTotal(page)).toBe(editedTotal);
    await expect(blocks).toHaveCount(templateBlocks + 1);
    await expect(edges).toHaveCount(templateEdges + 1);
  });

  expect(foreignRequests, 'requisições para fora da origem do site').toEqual([]);
});

/**
 * Sanidade da asserção de rede: uma chamada à `apiBaseUrl` do `/config.json` é registrada. Se a
 * API passasse a ter a mesma origem do site, a asserção do fluxo deixaria de valer e este teste
 * falharia. A rota é interceptada: nada sai da máquina.
 */
test('a guarda de rede acusa uma chamada à API', async ({ page, baseURL }) => {
  if (baseURL === undefined) throw new Error('baseURL não configurada');
  const foreignRequests = watchForeignRequests(page, baseURL);
  await page.goto('/');
  await expect(totalLine(page)).toBeVisible();
  expect(foreignRequests).toEqual([]);

  const config = (await (await page.request.get('/config.json')).json()) as { apiBaseUrl: string };
  const apiUrl = `${config.apiBaseUrl}/designs`;
  await page.route(`${config.apiBaseUrl}/**`, (route) => route.abort());
  await page.evaluate((url) => fetch(url).catch(() => undefined), apiUrl);

  expect(foreignRequests).toEqual([`GET ${apiUrl}`]);
});
