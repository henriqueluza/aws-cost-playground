import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../../test/axe';
import { EditorPage } from './EditorPage';
import { EstimateNotice } from './EstimateNotice';

const NOTICE = 'Estimativa on-demand, não é cotação oficial · data dos preços indisponível';

function stubWidth(matches: boolean | null) {
  if (matches !== null) {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  }
}

function renderPage(matches: boolean | null) {
  stubWidth(matches);
  const router = createMemoryRouter([{ path: '/', Component: EditorPage }], {
    initialEntries: ['/'],
  });
  return render(<RouterProvider router={router} />);
}

afterEach(() => vi.unstubAllGlobals());

describe('EstimateNotice', () => {
  it('é uma nota com a data e a origem', () => {
    const stamp = {
      status: 'ready',
      source: 'price-list',
      generatedAt: '2026-11-16T03:00:00Z',
    } as const;
    render(<EstimateNotice stamp={stamp} />);
    expect(screen.getByRole('note')).toHaveTextContent(
      'Estimativa on-demand, não é cotação oficial · preços de 2026-11-16 · AWS Price List',
    );
  });
});

describe.each([
  ['com matchMedia largo', true],
  ['sem matchMedia', null],
] as const)('EditorPage largo (%s)', (_nome, matches) => {
  it('expõe as regiões e os painéis', () => {
    renderPage(matches);
    expect(screen.getByRole('heading', { level: 1, name: 'Editor' })).toBeInTheDocument();
    expect(
      within(screen.getByRole('banner')).getByRole('heading', { name: 'Ações' }),
    ).toBeVisible();
    const paleta = screen.getByRole('complementary', { name: 'Paleta' });
    expect(within(paleta).getByRole('heading', { name: 'Paleta' })).toBeVisible();
    expect(within(screen.getByRole('main')).getByRole('heading', { name: 'Canvas' })).toBeVisible();
    const tabs = within(screen.getByRole('tablist', { name: 'Painéis' })).getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Custo', 'Bloco', 'Carga']);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(
      within(screen.getByRole('tabpanel')).getByRole('heading', { name: 'Preço' }),
    ).toBeVisible();
  });

  it('troca de aba por clique e mantém o aviso', async () => {
    renderPage(matches);
    await userEvent.click(screen.getByRole('tab', { name: 'Bloco' }));
    expect(
      within(screen.getByRole('tabpanel')).getByRole('heading', { name: 'Bloco' }),
    ).toBeVisible();
    expect(screen.getByRole('note')).toHaveTextContent(NOTICE);
  });

  it('navega as abas pelo teclado', async () => {
    const user = userEvent.setup();
    renderPage(matches);
    screen.getByRole('tab', { name: 'Custo' }).focus();
    await user.keyboard('{ArrowRight}');
    const bloco = screen.getByRole('tab', { name: 'Bloco' });
    expect(bloco).toHaveAttribute('aria-selected', 'true');
    expect(bloco).toHaveFocus();
    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Carga' })).toHaveFocus();
    await user.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: 'Custo' })).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Carga' })).toHaveAttribute('aria-selected', 'true');
  });

  it('não tem violações de acessibilidade', async () => {
    const { container } = renderPage(matches);
    await expectNoAxeViolations(container);
  });
});

describe('EditorPage estreito', () => {
  it('mostra o aviso de largura e o link, sem as regiões', async () => {
    const { container } = renderPage(false);
    expect(screen.getByRole('heading', { level: 1, name: 'Editor' })).toBeInTheDocument();
    expect(
      screen.getByText('A edição precisa de uma tela com pelo menos 1024 px de largura.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Meus designs' })).toHaveAttribute('href', '/designs');
    expect(screen.queryByRole('banner')).toBeNull();
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.getByRole('note')).toHaveTextContent(NOTICE);
    await expectNoAxeViolations(container);
  });
});
