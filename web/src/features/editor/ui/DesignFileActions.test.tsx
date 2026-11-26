import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { designDocumentSchema } from '../../../shared/lib/design';
import { expectNoAxeViolations } from '../../../test/axe';
import { adrExampleDesign } from '../../../test/designFixtures';
import { designStore } from '../hooks/designStore';
import { DESIGN_FILE_NAME, parseDesignFile } from '../model/designFile';
import { EMPTY_STATE } from '../model/editorState';
import { ActionBar } from './ActionBar';

const contracts = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../contracts');
const scenario = readFileSync(resolve(contracts, 'scenarios/app-classico.json'), 'utf8');
const adr = designDocumentSchema.parse(adrExampleDesign);
const json = (text: string, name = 'design.json') =>
  new File([text], name, { type: 'application/json' });
const picker = () => screen.getByLabelText<HTMLInputElement>('Arquivo JSON do design');
const upload = (file: File) => userEvent.upload(picker(), file, { applyAccept: false });

const renderBar = () =>
  render(
    <header>
      <ActionBar />
    </header>,
  );

let blobs: Blob[];
let revoked: string[];
let clicked: { download: string; href: string }[];
/** Store vazia e limpa: o `baseline` acompanha o documento, como depois de um design aberto. */
const CLEAN_EMPTY = { ...EMPTY_STATE, baseline: EMPTY_STATE.document };
beforeEach(() => {
  designStore.setState(CLEAN_EMPTY);
  blobs = [];
  revoked = [];
  clicked = [];
  vi.stubGlobal(
    'URL',
    Object.assign(URL, {
      createObjectURL: (b: Blob) => (blobs.push(b), `blob:test/${blobs.length}`),
      revokeObjectURL: (u: string) => revoked.push(u),
    }),
  );
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicked.push({ download: this.download, href: this.href });
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  designStore.setState(CLEAN_EMPTY);
});

describe('Abrir arquivo', () => {
  it('oferece só JSON no seletor e tem nomes acessíveis', async () => {
    renderBar();
    expect(picker()).toHaveAttribute('accept', '.json,application/json');
    expect(screen.getByRole('button', { name: 'Abrir arquivo' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Baixar JSON' })).toBeEnabled();
    await expectNoAxeViolations(document.body);
  });

  it('com design vazio, abre direto e usa a store só depois de validar', async () => {
    renderBar();
    await upload(json(scenario));
    await waitFor(() => expect(designStore.getState().document.blocks.length).toBeGreaterThan(5));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('com conteúdo já carregado e sem alteração (o template, por exemplo), abre direto', async () => {
    designStore.setState({ ...EMPTY_STATE, document: adr, baseline: adr });
    renderBar();
    await upload(json(scenario));
    await waitFor(() => expect(designStore.getState().document).not.toBe(adr));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('com alteração não salva, pede confirmação; cancelar não altera nada', async () => {
    designStore.setState({ ...EMPTY_STATE, document: adr });
    const user = userEvent.setup();
    renderBar();
    await upload(json(scenario));
    const dialog = await screen.findByRole('dialog', { name: 'Substituir o design atual?' });
    expect(dialog).toHaveTextContent('O design atual (2 blocos)');
    expect(designStore.getState().document).toBe(adr);
    // foco no primeiro controle (Cancelar), Esc também cancela
    expect(within(dialog).getByRole('button', { name: 'Cancelar' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(designStore.getState().document).toBe(adr);
  });

  it('confirmar substitui o design e zera seleção e posições', async () => {
    designStore.setState({
      ...EMPTY_STATE,
      document: adr,
      selection: { kind: 'block', id: 'blk_assets' },
    });
    const user = userEvent.setup();
    renderBar();
    await upload(json(scenario));
    await user.click(await screen.findByRole('button', { name: 'Substituir design' }));
    const next = designStore.getState();
    expect(next.document).toEqual(
      parseDesignFile(scenario).ok
        ? (parseDesignFile(scenario) as { document: unknown }).document
        : null,
    );
    expect(next.selection).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it.each([
    ['não é JSON', 'isto não é json {', 'O arquivo não é um JSON válido.'],
    ['não é design', '{"a":1}', 'O arquivo não é um design deste produto.'],
    [
      'versão futura',
      JSON.stringify({ ...adr, schemaVersion: 2 }),
      'O arquivo é de uma versão do design que este editor não abre.',
    ],
  ])(
    'arquivo inválido (%s) mostra a mensagem própria e não altera o design',
    async (_n, text, message) => {
      designStore.setState({ ...EMPTY_STATE, document: adr });
      const user = userEvent.setup();
      renderBar();
      await upload(json(text));
      const dialog = await screen.findByRole('dialog', {
        name: 'Não foi possível abrir o arquivo',
      });
      expect(within(dialog).getByRole('alert')).toHaveTextContent(message);
      expect(dialog).toHaveTextContent('O design atual não foi alterado.');
      expect(dialog.textContent).not.toContain('Unexpected');
      expect(designStore.getState().document).toBe(adr);
      await expectNoAxeViolations(document.body);
      await user.click(within(dialog).getByRole('button', { name: 'Fechar' }));
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(screen.getByRole('button', { name: 'Abrir arquivo' })).toHaveFocus();
    },
  );

  it('arquivo grande demais é recusado sem ser lido', async () => {
    renderBar();
    const big = json('x');
    Object.defineProperty(big, 'size', { value: 350 * 1024 + 1 });
    const text = vi.spyOn(big, 'text');
    await upload(big);
    expect(await screen.findByRole('alert')).toHaveTextContent('passa de 350 KB');
    expect(text).not.toHaveBeenCalled();
  });

  it('rótulo com marcação aparece como texto, sem virar elemento', async () => {
    const label = '<img src=x onerror=alert(1)>';
    const doc = { ...adr, blocks: [{ ...adr.blocks[0], label }], edges: [] };
    renderBar();
    await upload(json(JSON.stringify(doc)));
    await waitFor(() => expect(designStore.getState().document.blocks[0]?.label).toBe(label));
    expect(document.querySelector('img')).toBeNull();
  });
});

describe('Baixar JSON', () => {
  it('baixa o documento com nome fixo, application/json e revoga a URL', async () => {
    designStore.setState({ ...EMPTY_STATE, document: adr });
    renderBar();
    await userEvent.click(screen.getByRole('button', { name: 'Baixar JSON' }));
    expect(clicked).toEqual([{ download: DESIGN_FILE_NAME, href: 'blob:test/1' }]);
    expect(blobs[0]?.type).toBe('application/json');
    const text = await blobs[0]?.text();
    expect(JSON.parse(text ?? '').schemaVersion).toBe(1);
    expect(text).not.toContain('data:');
    await waitFor(() => expect(revoked).toEqual(['blob:test/1']));
    expect(document.querySelector('a[download]')).toBeNull();
  });

  it('ida e volta: o que foi baixado abre como o mesmo design', async () => {
    designStore.setState({ ...EMPTY_STATE, document: adr });
    renderBar();
    await userEvent.click(screen.getByRole('button', { name: 'Baixar JSON' }));
    const text = (await blobs[0]?.text()) ?? '';
    designStore.setState(CLEAN_EMPTY);
    await upload(json(text));
    await waitFor(() => expect(designStore.getState().document).toEqual(adr));
  });
});
