import { expect, test, type Page } from '@playwright/test';
import { DAILY_LIMIT, E2E_EMAIL, mockBackend, type MockBackend } from './support/mockBackend';

test.use({ viewport: { width: 1440, height: 900 } });

const diagramOf = (page: Page) =>
  page.getByRole('application', { name: 'Diagrama da arquitetura' });
const blocksOf = (page: Page) => diagramOf(page).getByRole('group', { name: /por mês/ });

/** Abre o site com login e API simulados e entra pelo botão da barra do editor. */
async function signedIn(page: Page, baseURL: string | undefined): Promise<MockBackend> {
  if (baseURL === undefined) throw new Error('baseURL não configurada');
  const backend = await mockBackend(page, baseURL);
  await page.goto('/');
  await page.getByRole('button', { name: 'Entrar', exact: true }).first().click();
  await expect(page.getByRole('link', { name: `Conta de ${E2E_EMAIL}` })).toBeVisible();
  return backend;
}

/** Espera o diagrama renderizar e devolve quantos blocos ele tem. */
async function countBlocks(page: Page): Promise<number> {
  await expect(blocksOf(page)).not.toHaveCount(0);
  return blocksOf(page).count();
}

/** Adiciona um S3 pela paleta (pelo teclado), para o design ter uma alteração reconhecível. */
async function addS3(page: Page) {
  const before = await countBlocks(page);
  const item = page
    .getByRole('complementary', { name: 'Paleta' })
    .getByRole('button', { name: 'S3', exact: true });
  await item.focus();
  await page.keyboard.press('Enter');
  await expect(blocksOf(page)).toHaveCount(before + 1);
  return before + 1;
}

async function saveAs(page: Page, name: string) {
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Salvar design' });
  await dialog.getByRole('textbox', { name: 'Nome do design' }).fill(name);
  await dialog.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Salvo' })).toBeVisible();
}

test('entrar, salvar, listar, reabrir e apagar um design', async ({ page, baseURL }) => {
  const backend = await signedIn(page, baseURL);

  const total = await addS3(page);
  await saveAs(page, 'Design E2E');
  expect(backend.designs).toHaveLength(1);

  await page.getByRole('link', { name: 'Meus designs' }).click();
  const row = page.getByRole('row', { name: /Design E2E/ });
  await expect(row).toContainText(`${total} blocos`);

  await row.getByRole('button', { name: 'Abrir Design E2E' }).click();
  await expect(page).toHaveURL('/');
  await expect(blocksOf(page)).toHaveCount(total);

  await page.getByRole('link', { name: 'Meus designs' }).click();
  await page.getByRole('button', { name: 'Apagar Design E2E' }).click();
  await page
    .getByRole('dialog', { name: 'Apagar design?' })
    .getByRole('button', { name: 'Apagar', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Nenhum design salvo' })).toBeVisible();
  expect(backend.designs).toHaveLength(0);
});

test('re-estimar a carga preenche o uso e preserva o override feito antes', async ({
  page,
  baseURL,
}) => {
  const backend = await signedIn(page, baseURL);
  const diagram = diagramOf(page);

  // Override à mão no armazenamento do S3 do template, antes de estimar.
  await diagram.getByRole('group', { name: /^S3, Arquivos estáticos,/ }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('tab', { name: 'Bloco' }).click();
  const storage = page.getByRole('textbox', { name: 'Armazenamento' });
  await storage.fill('5000');
  await storage.press('Enter');
  await expect(page.getByText('alterado à mão').first()).toBeVisible();

  await page.getByRole('tab', { name: 'Carga' }).click();
  await page.getByRole('button', { name: 'Re-estimar carga' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Estimativa aplicada' })).toContainText(
    '2 blocos e 0 conexões',
  );
  await expect(page.getByText(`Restam ${DAILY_LIMIT - 1} de ${DAILY_LIMIT} hoje`)).toBeVisible();
  expect(backend.estimateBodies).toHaveLength(1);

  // O S3 mantém o override; a estimativa só trocou o `usage` por baixo dele.
  await page.getByRole('tab', { name: 'Bloco' }).click();
  await expect(page.getByRole('textbox', { name: 'Armazenamento' })).toHaveValue('5000');
  await expect(page.getByText('alterado à mão').first()).toBeVisible();

  // O Lambda não tinha override: recebe o valor estimado.
  await diagram.getByRole('group', { name: /^Lambda, Tarefas assíncronas,/ }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('textbox', { name: 'Requisições por mês' })).toHaveValue('4000000');
  await expect(page.getByText('estimado pela LLM').first()).toBeVisible();
});

for (const scope of ['user', 'global'] as const) {
  test(`quota esgotada (${scope}) mostra a mensagem certa e não altera o diagrama`, async ({
    page,
    baseURL,
  }) => {
    const backend = await signedIn(page, baseURL);
    backend.exhaustQuota(scope);
    const blocks = await countBlocks(page);

    await page.getByRole('tab', { name: 'Carga' }).click();
    await page.getByRole('button', { name: 'Re-estimar carga' }).click();
    await expect(page.getByText(/O diagrama não foi alterado\./).first()).toBeVisible();
    await expect(
      page
        .getByText(
          scope === 'user'
            ? /Você usou as estimativas de hoje\. Elas voltam/
            : /O limite diário do serviço acabou; volta amanhã\./,
        )
        .first(),
    ).toBeVisible();
    await expect(blocksOf(page)).toHaveCount(blocks);
  });
}

test('conflito de versão avisa, não sobrescreve e oferece salvar como cópia', async ({
  page,
  baseURL,
}) => {
  const backend = await signedIn(page, baseURL);
  const original = await countBlocks(page);
  await addS3(page);
  await saveAs(page, 'Design em conflito');
  const [saved] = backend.designs;
  if (saved === undefined) throw new Error('o design não chegou ao servidor');

  // Outro dispositivo grava primeiro; a edição local fica pendente e o salvar bate na versão velha.
  backend.bumpVersion(saved.id);
  await addS3(page);
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();

  const dialog = page.getByRole('dialog', { name: 'Não foi possível salvar' });
  await expect(dialog).toContainText(
    'Este design foi alterado em outro lugar. Nada foi sobrescrito',
  );
  expect(saved.doc.blocks).toHaveLength(original + 1);

  await dialog.getByRole('button', { name: 'Salvar como cópia' }).click();
  await expect.poll(() => backend.designs.length).toBe(2);
  expect(saved.doc.blocks).toHaveLength(original + 1);
});

test('excluir a conta encerra a sessão', async ({ page, baseURL }) => {
  const backend = await signedIn(page, baseURL);
  await addS3(page);
  await saveAs(page, 'Some com a conta');
  expect(backend.designs).toHaveLength(1);

  await page.getByRole('link', { name: `Conta de ${E2E_EMAIL}` }).click();
  await expect(page.getByRole('heading', { name: 'Conta', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Excluir minha conta…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Excluir a conta para sempre?' });
  const confirm = dialog.getByRole('button', { name: 'Excluir conta' });
  await expect(confirm).toBeDisabled();
  await dialog.getByRole('textbox').fill('EXCLUIR');
  await confirm.click();

  // A sessão acaba: volta ao editor sem conta e o botão de entrar reaparece.
  await expect(page.getByRole('button', { name: 'Entrar', exact: true }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: `Conta de ${E2E_EMAIL}` })).toHaveCount(0);
  expect(backend.accountDeleted()).toBe(true);
  expect(backend.designs).toHaveLength(0);
  expect(backend.revoked()).toBe(1);
});
