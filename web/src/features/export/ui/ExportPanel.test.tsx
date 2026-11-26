import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adrExampleDesign } from '../../../test/designFixtures';
import { expectNoAxeViolations } from '../../../test/axe';
import { exportDesign } from '../application/exportDesign';
import { ExportPanel } from './ExportPanel';

const current = vi.hoisted(() => ({ document: {} as unknown }));
vi.mock('../../editor', () => ({
  useDesignStore: (select: (s: { document: unknown }) => unknown) => select(current),
}));

let created: Blob[];
let revoked: string[];
let downloads: string[];

beforeEach(() => {
  created = [];
  revoked = [];
  downloads = [];
  URL.createObjectURL = vi.fn((blob: Blob) => {
    created.push(blob);
    return `blob:test/${created.length}`;
  });
  URL.revokeObjectURL = vi.fn((url: string) => void revoked.push(url));
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloads.push(this.download);
  });
  current.document = adrExampleDesign;
});
afterEach(() => vi.restoreAllMocks());

const clickExport = () =>
  userEvent.click(screen.getByRole('button', { name: 'Exportar Terraform' }));

describe('ExportPanel', () => {
  it('baixa main.tf com o conteúdo do design atual e revoga a URL', async () => {
    render(<ExportPanel />);
    await clickExport();
    const expected = exportDesign(adrExampleDesign);
    if (!expected.ok) throw new Error('fixture inválida');
    expect(downloads).toEqual(['main.tf']);
    expect(created[0]?.type).toBe('text/plain;charset=utf-8');
    expect(await created[0]?.text()).toBe(expected.files[0]?.content);
    expect(revoked).toEqual(['blob:test/1']);
    expect(document.querySelector('a')).toBeNull();
  });

  it.each(['../../evil.sh', '"><img src=x onerror=alert(1)>'])(
    'rótulo malicioso %s não muda o nome nem aparece no DOM',
    async (label) => {
      current.document = {
        ...adrExampleDesign,
        blocks: adrExampleDesign.blocks.map((b, i) => (i === 0 ? { ...b, label } : b)),
      };
      const { container } = render(<ExportPanel />);
      await clickExport();
      expect(downloads).toEqual(['main.tf']);
      expect(container.innerHTML).not.toContain(label);
      expect(container.querySelector('img')).toBeNull();
    },
  );

  it('design inválido mostra o erro anunciado e não baixa nada', async () => {
    current.document = { schemaVersion: 99 };
    render(<ExportPanel />);
    await clickExport();
    expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível exportar');
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(downloads).toEqual([]);
  });

  it('mostra sempre o aviso de ponto de partida e de estimativa', () => {
    render(<ExportPanel />);
    const note = screen.getByRole('note');
    expect(note).toHaveTextContent('ponto de partida, sem garantia');
    expect(note).toHaveTextContent('Revise');
    expect(note).toHaveTextContent('estimativa, não cotação oficial');
  });

  it('não tem violações de acessibilidade, com e sem erro', async () => {
    current.document = { schemaVersion: 99 };
    const { container } = render(<ExportPanel />);
    await expectNoAxeViolations(container);
    await clickExport();
    await expectNoAxeViolations(container);
  });
});
