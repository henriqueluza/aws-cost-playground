import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import contract from '../../../../../contracts/blocks.json';
import { expectNoAxeViolations } from '../../../test/axe';
import { designStore } from '../hooks/designStore';
import { EMPTY_STATE } from '../model/editorState';
import { BLOCK_DRAG_MIME } from '../model/palette';
import { PalettePanel } from './PalettePanel';

afterEach(() => designStore.setState(EMPTY_STATE));

describe('PalettePanel', () => {
  it('mostra todos os blocos do contrato, em cinco grupos', () => {
    render(<PalettePanel />);
    const names = contract.blocks.map((b) => b.name);
    for (const name of names) expect(screen.getByRole('button', { name })).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(20);
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Computação',
      'Dados',
      'Rede',
      'Segurança',
      'Operação',
    ]);
    const group = screen.getByRole('region', { name: 'Computação' });
    expect(
      within(group)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['EC2', 'ECS', 'Lambda']);
  });

  it('filtra pela busca e mostra o estado vazio, que limpa a busca', async () => {
    const user = userEvent.setup();
    render(<PalettePanel />);
    await user.type(screen.getByLabelText('Buscar bloco'), 'SEGURANCA');
    expect(screen.getByRole('heading', { name: 'Nenhum bloco encontrado' })).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Buscar bloco'));
    await user.type(screen.getByLabelText('Buscar bloco'), 'dynamo');
    expect(screen.getAllByRole('button')).toHaveLength(1);
    await user.clear(screen.getByLabelText('Buscar bloco'));
    await user.type(screen.getByLabelText('Buscar bloco'), 'zzz');
    expect(screen.getByRole('heading', { name: 'Nenhum bloco encontrado' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Limpar busca' }));
    expect(screen.getAllByRole('button')).toHaveLength(20);
  });

  it('adiciona o bloco com Enter e com Espaço, sem sobrepor o anterior', async () => {
    const user = userEvent.setup();
    render(<PalettePanel />);
    await user.tab();
    await user.tab();
    expect(screen.getByRole('button', { name: 'EC2' })).toHaveFocus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    const { document, layout } = designStore.getState();
    expect(document.blocks).toHaveLength(2);
    expect(document.blocks[0]).toMatchObject({
      type: 'aws.ec2',
      label: 'EC2',
      attributes: { instanceType: 't3.small' },
      usage: { source: 'default' },
    });
    const [a, b] = document.blocks.map((blk) => layout[blk.id]);
    expect(a).not.toEqual(b);
    expect(screen.getByRole('status')).toHaveTextContent('EC2 adicionado ao canvas.');
  });

  it('navega por setas com um só ponto de Tab', async () => {
    const user = userEvent.setup();
    render(<PalettePanel />);
    const items = screen.getAllByRole('button');
    expect(items.filter((b) => b.tabIndex === 0)).toHaveLength(1);
    items[0]?.focus();
    await user.keyboard('{ArrowDown}');
    expect(items[1]).toHaveFocus();
    await user.keyboard('{End}');
    expect(items.at(-1)).toHaveFocus();
    await user.keyboard('{Home}');
    expect(items[0]).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(screen.getByLabelText('Buscar bloco')).toHaveFocus();
  });

  it('começa o arrasto levando só o tipo do bloco', () => {
    render(<PalettePanel />);
    const data: Record<string, string> = {};
    const dataTransfer = { setData: (t: string, v: string) => (data[t] = v), effectAllowed: '' };
    const item = screen.getByRole('button', { name: 'S3' });
    expect(item).toHaveAttribute('draggable', 'true');
    const event = new Event('dragstart', { bubbles: true });
    Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
    item.dispatchEvent(event);
    expect(data).toEqual({ [BLOCK_DRAG_MIME]: 'aws.s3' });
  });

  it('não tem violação de acessibilidade', async () => {
    const { container } = render(<PalettePanel />);
    await expectNoAxeViolations(container);
  });
});
