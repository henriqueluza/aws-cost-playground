import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../../test/axe';
import { catalogOf } from '../../../test/catalogFixtures';
import { adrExampleDesign } from '../../../test/designFixtures';
import { catalogServices, priceCatalogKey } from '../../pricing';
import { designStore } from '../hooks/designStore';
import { EMPTY_STATE } from '../model/editorState';
import { EditorPage } from './EditorPage';
import { EstimateNotice } from './EstimateNotice';

const NOTICE =
  'Estimativa on-demand, não é cotação oficial · a data dos preços aparece com o primeiro bloco';
const READY_NOTICE =
  'Estimativa on-demand, não é cotação oficial · preços de 2026-11-23 · valores de exemplo';

const WIDE_QUERY = '(min-width: 1024px)';
const ROOMY_QUERY = '(min-width: 1200px)';

type Listener = () => void;

function stubWidth(initial: boolean | null, roomy?: boolean) {
  const queries: string[] = [];
  let current = initial ?? true;
  const listeners = new Set<Listener>();
  if (initial !== null) {
    vi.stubGlobal('matchMedia', (query: string) => {
      queries.push(query);
      return {
        get matches() {
          if (query === WIDE_QUERY) return current;
          return query === ROOMY_QUERY ? (roomy ?? current) : false;
        },
        media: query,
        addEventListener: (_type: string, fn: Listener) => listeners.add(fn),
        removeEventListener: (_type: string, fn: Listener) => listeners.delete(fn),
      };
    });
  }
  return {
    queries,
    set(next: boolean) {
      current = next;
      act(() => listeners.forEach((fn) => fn()));
    },
  };
}

function renderPage(matches: boolean | null, client?: QueryClient, roomy?: boolean) {
  const media = stubWidth(matches, roomy);
  const queryClient = client ?? new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([{ path: '/', Component: EditorPage }], {
    initialEntries: ['/'],
  });
  return {
    ...render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    ),
    media,
  };
}

beforeEach(() => designStore.setState(EMPTY_STATE));

afterEach(() => {
  vi.unstubAllGlobals();
  designStore.setState(EMPTY_STATE);
});

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
    const banner = screen.getByRole('banner');
    expect(within(banner).getByRole('heading', { name: 'Ações' })).toBeVisible();
    expect(within(banner).getByRole('button', { name: 'Abrir arquivo' })).toBeVisible();
    expect(within(banner).getByRole('button', { name: 'Baixar JSON' })).toBeVisible();
    const paleta = screen.getByRole('complementary', { name: 'Paleta' });
    expect(within(paleta).getByRole('heading', { name: 'Paleta' })).toBeVisible();
    expect(within(screen.getByRole('main')).getByRole('heading', { name: 'Canvas' })).toBeVisible();
    const tabs = within(
      screen.getByRole('tablist', { name: 'Custo, bloco, carga e exportação' }),
    ).getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Custo', 'Bloco', 'Carga', 'Exportar']);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(
      within(screen.getByRole('tabpanel')).getByRole('heading', { name: 'Preço' }),
    ).toBeVisible();
  });

  it('traz o painel de exportação na aba Exportar', async () => {
    renderPage(matches);
    await userEvent.click(screen.getByRole('tab', { name: 'Exportar' }));
    const panel = screen.getByRole('tabpanel');
    expect(within(panel).getByRole('heading', { name: 'Exportar' })).toBeVisible();
    expect(within(panel).getByRole('button', { name: 'Exportar Terraform' })).toBeVisible();
  });

  it('troca de aba por clique e mantém o aviso', async () => {
    renderPage(matches);
    await userEvent.click(screen.getByRole('tab', { name: 'Bloco' }));
    expect(
      within(screen.getByRole('tabpanel')).getByRole('heading', {
        name: 'Nenhum bloco selecionado',
      }),
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
    expect(screen.getByRole('tab', { name: 'Exportar' })).toHaveFocus();
    await user.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: 'Custo' })).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Exportar' })).toHaveAttribute('aria-selected', 'true');
  });

  it('Tab a partir da aba ativa foca o tabpanel visível', async () => {
    const user = userEvent.setup();
    renderPage(matches);
    screen.getByRole('tab', { name: 'Custo' }).focus();
    await user.tab();
    expect(screen.getByRole('tabpanel')).toHaveFocus();
  });

  it('liga as linhas do painel de custo à seleção da store, nos dois sentidos', async () => {
    expect(designStore.getState().loadDesign(adrExampleDesign).ok).toBe(true);
    const { document } = designStore.getState();
    const services = catalogServices(document);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(
      priceCatalogKey(document.region, services),
      catalogOf(Object.fromEntries(services.map((service) => [service, []]))),
    );
    renderPage(matches, client);
    const row = screen.getByRole('button', { name: /^API handler/ });
    await userEvent.click(row);
    expect(designStore.getState().selection).toEqual({ kind: 'block', id: 'blk_fn_api' });
    act(() => void designStore.getState().select({ kind: 'edge', id: 'edg_1' }));
    expect(screen.getByRole('button', { name: /^Uploads \u2192 Internet/ })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(row).not.toHaveAttribute('aria-current');
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
    const main = screen.getByRole('main');
    expect(within(main).getByRole('heading', { level: 1, name: 'Editor' })).toBeInTheDocument();
    expect(within(main).getByRole('link', { name: 'Meus designs' })).toBeInTheDocument();
    expect(within(main).getByRole('note')).toBeInTheDocument();
    expect(within(main).getByRole('button', { name: 'Baixar JSON' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Abrir arquivo' })).toBeNull();
    expect(screen.queryByRole('banner')).toBeNull();
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.getByRole('note')).toHaveTextContent(NOTICE);
    await expectNoAxeViolations(container);
  });
});

describe('EditorPage e a largura em runtime', () => {
  it('consulta exatamente (min-width: 1024px) e (min-width: 1200px)', () => {
    const { media } = renderPage(true);
    expect(media.queries.length).toBeGreaterThan(0);
    expect(new Set(media.queries)).toEqual(new Set([WIDE_QUERY, ROOMY_QUERY]));
  });

  it('alterna entre largo e estreito ao disparar change', () => {
    const { media } = renderPage(true);
    expect(
      screen.getByRole('tablist', { name: 'Custo, bloco, carga e exportação' }),
    ).toBeInTheDocument();
    media.set(false);
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.getByRole('main')).toBeInTheDocument();
    media.set(true);
    expect(
      screen.getByRole('tablist', { name: 'Custo, bloco, carga e exportação' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('banner')).toBeInTheDocument();
  });
});

describe('Paleta recolhível (de 1024 a 1199 px)', () => {
  const trilho = () => screen.getByRole('complementary', { name: 'Paleta' });

  it('abre recolhida abaixo de 1200 px, só com o botão que a mostra', () => {
    renderPage(true, undefined, false);
    expect(within(trilho()).queryByRole('heading', { name: 'Paleta' })).toBeNull();
    expect(within(trilho()).queryByRole('textbox')).toBeNull();
    const mostrar = within(trilho()).getByRole('button', { name: 'Mostrar a paleta' });
    expect(mostrar).toHaveAttribute('aria-expanded', 'false');
  });

  it('abre expandida a partir de 1200 px, com o botão de recolher', () => {
    renderPage(true, undefined, true);
    expect(within(trilho()).getByRole('heading', { name: 'Paleta' })).toBeVisible();
    expect(within(trilho()).getByRole('button', { name: 'Recolher a paleta' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('mostrar e recolher pelo teclado levam o foco ao botão que ficou no lugar', async () => {
    const user = userEvent.setup();
    renderPage(true, undefined, false);
    within(trilho()).getByRole('button', { name: 'Mostrar a paleta' }).focus();
    await user.keyboard('{Enter}');
    expect(within(trilho()).getByRole('heading', { name: 'Paleta' })).toBeVisible();
    expect(within(trilho()).getByRole('button', { name: 'Recolher a paleta' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(within(trilho()).getByRole('button', { name: 'Mostrar a paleta' })).toHaveFocus();
  });

  it('clicar em Mostrar a paleta abre o painel com a busca', async () => {
    renderPage(true, undefined, false);
    await userEvent.click(within(trilho()).getByRole('button', { name: 'Mostrar a paleta' }));
    expect(within(trilho()).getByRole('heading', { name: 'Paleta' })).toBeVisible();
    expect(within(trilho()).getByRole('textbox', { name: 'Buscar bloco' })).toBeVisible();
  });

  it('não tem violações de acessibilidade, recolhida', async () => {
    const { container } = renderPage(true, undefined, false);
    await expectNoAxeViolations(container);
  });
});

describe.each([
  ['largo', true],
  ['estreito', false],
] as const)('EditorPage com catálogo pronto (%s)', (_nome, matches) => {
  it('mostra a data e a origem do catálogo sem buscar nada', () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error('nenhuma chamada de rede esperada')));
    vi.stubGlobal('fetch', fetchSpy);
    expect(designStore.getState().loadDesign(adrExampleDesign).ok).toBe(true);
    const { document } = designStore.getState();
    const services = catalogServices(document);
    expect(services.length).toBeGreaterThan(0);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(
      priceCatalogKey(document.region, services),
      catalogOf(Object.fromEntries(services.map((service) => [service, []]))),
    );
    renderPage(matches, client);
    expect(screen.getByRole('note')).toHaveTextContent(READY_NOTICE);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
