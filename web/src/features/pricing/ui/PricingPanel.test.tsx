import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { designDocumentSchema, type Block, type DesignDocument } from '../../../shared/lib/design';
import { expectNoAxeViolations } from '../../../test/axe';
import { catalogOf } from '../../../test/catalogFixtures';
import { adrExampleDesign } from '../../../test/designFixtures';
import { buildCostRows } from '../application/costRows';
import { CatalogError } from '../application/loadCatalog';
import type { PriceCatalogState } from '../hooks/usePriceCatalog';
import { estimate } from '../model/engine';
import { PricingPanel, type CostSelection } from './PricingPanel';

const baseDesign = designDocumentSchema.parse(adrExampleDesign);
const freeTier = (pool: string) => ({ quantity: '1000000', pool });
const catalog = catalogOf({
  lambda: [
    { sku: 'lambda-requests-arm64', tiers: [[null, '0.0000002']], freeTier: freeTier('r') },
    {
      sku: 'lambda-duration-arm64',
      tiers: [[null, '0.0000133334']],
      freeTier: { quantity: '400000', pool: 'd' },
    },
  ],
});
const ready = (updating = false): PriceCatalogState => ({
  status: 'ready',
  catalog,
  source: 'seed',
  generatedAt: '2026-11-23T12:00:00Z',
  updating,
});

function setup(
  state: PriceCatalogState,
  selection: CostSelection = null,
  design: DesignDocument = baseDesign,
) {
  const onSelect = vi.fn();
  const view = render(
    <PricingPanel design={design} catalog={state} selection={selection} onSelect={onSelect} />,
  );
  return { onSelect, ...view };
}

describe('PricingPanel', () => {
  it('mostra o total, fixo e variável e a lista por bloco com o item sem preço por último', () => {
    setup(ready());
    expect(screen.getByRole('heading', { name: 'Preço' })).toBeVisible();
    expect(screen.getAllByText('US$ 0,40')[0]).toBeVisible();
    expect(screen.getByText(/Fixo US\$ 0,00 · Variável US\$ 0,40/)).toBeVisible();
    const table = screen.getByRole('table', { name: 'Por bloco' });
    const names = within(table)
      .getAllByRole('rowheader')
      .map((h) => h.textContent);
    expect(names[0]).toContain('API handler');
    expect(names[1]).toContain('Uploads');
    expect(names[1]).toContain('sem preço');
    expect(
      within(screen.getByRole('table', { name: 'Por aresta' })).getAllByRole('row'),
    ).toHaveLength(2);
  });

  it('avisa que o total é parcial quando há item sem preço', () => {
    setup(ready());
    expect(screen.getByRole('status')).toHaveTextContent(
      '1 item está sem preço e ficou fora do total. O total é parcial.',
    );
  });

  it('abre o detalhamento com SKU, quantidade e preço unitário, e seleciona o bloco', async () => {
    const { onSelect } = setup(ready());
    const user = userEvent.setup();
    const button = screen.getByRole('button', { name: /API handler/ });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    await user.click(button);
    expect(onSelect).toHaveBeenCalledWith({ kind: 'block', id: 'blk_fn_api' });
    expect(button).toHaveAttribute('aria-expanded', 'true');
    const detail = document.getElementById(button.getAttribute('aria-controls') ?? '');
    expect(detail).toBeVisible();
    expect(within(detail as HTMLElement).getByText('lambda-requests-arm64')).toBeVisible();
    expect(within(detail as HTMLElement).getByText('2.000.000 × US$ 0,0000002')).toBeVisible();
    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(detail).not.toBeVisible();
  });

  it('explica o item sem preço no detalhamento', async () => {
    setup(ready());
    await userEvent.setup().click(screen.getByRole('button', { name: /^Uploads(?! \u2192)/ }));
    expect(screen.getByText(/Sem preço no catálogo para este item/)).toBeVisible();
  });

  it('seleciona pelo teclado (Enter e espaço) e a aresta também é selecionável', async () => {
    const { onSelect } = setup(ready());
    const user = userEvent.setup();
    screen.getByRole('button', { name: /API handler/ }).focus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(onSelect).toHaveBeenCalledTimes(2);
    await user.click(within(screen.getByRole('table', { name: 'Por aresta' })).getByRole('button'));
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'edge', id: 'edg_1' });
  });

  it('destaca a linha do bloco selecionado e a leva para a vista', () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    setup(ready(), { kind: 'block', id: 'blk_assets' });
    const button = screen.getByRole('button', { name: /^Uploads(?! \u2192)/ });
    expect(button).toHaveAttribute('aria-current', 'true');
    expect(button.closest('tbody')).toHaveAttribute('data-selected', 'true');
    expect(screen.getByRole('button', { name: /API handler/ })).not.toHaveAttribute('aria-current');
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest' });
  });

  it('mostra o estado vazio sem bloco com preço', () => {
    setup({ status: 'idle' });
    expect(screen.getByRole('heading', { name: 'Nenhum bloco com preço' })).toBeVisible();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('mostra o carregamento com o layout final', () => {
    setup({ status: 'loading' });
    expect(screen.getByRole('status')).toHaveTextContent('Carregando preços');
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
  });

  it.each([
    ['network', /Não foi possível buscar os preços/],
    ['missing', /Sem preços de us-east-1 neste momento\./],
    ['integrity', /verificação de integridade/],
    ['invalid', /inválido e foi recusado/],
    ['too-large', /inválido e foi recusado/],
  ] as const)('erro %s: texto próprio e tentar de novo', async (kind, text) => {
    const retry = vi.fn();
    setup({ status: 'error', error: new CatalogError(kind), retry });
    expect(screen.getByRole('alert')).toHaveTextContent(text);
    expect(screen.queryByText(/Erro do catálogo de preços/)).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('com o catálogo a caminho mantém o resultado anterior em vez de piscar sem preço', () => {
    const { rerender, onSelect } = setup(ready());
    const bigger = {
      ...baseDesign,
      blocks: [...baseDesign.blocks, { ...(baseDesign.blocks[1] as Block), id: 'blk_new' }],
    };
    rerender(
      <PricingPanel design={bigger} catalog={ready(true)} selection={null} onSelect={onSelect} />,
    );
    expect(screen.getByText('Atualizando os preços…')).toBeVisible();
    expect(screen.getAllByRole('rowheader')).toHaveLength(3);
    expect(screen.getAllByText('US$ 0,40')[0]).toBeVisible();
  });

  it('trata rótulo do usuário como texto, nunca como HTML', () => {
    const evil = {
      ...baseDesign,
      blocks: [{ ...(baseDesign.blocks[0] as Block), label: '<img src=x onerror=alert(1)>' }],
      edges: [],
    };
    setup(ready(), null, evil);
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeVisible();
    expect(document.querySelector('img')).toBeNull();
  });

  it.each([
    ['pronto', ready()],
    ['vazio', { status: 'idle' } as const],
    ['carregando', { status: 'loading' } as const],
    ['erro', { status: 'error', error: new CatalogError('network'), retry: () => {} } as const],
  ])('não tem violação de acessibilidade (%s)', async (_, state) => {
    const { container } = setup(state);
    await expectNoAxeViolations(container);
  });

  it('com 100 blocos, o recálculo cabe no orçamento de 100 ms', () => {
    const block = baseDesign.blocks[0] as Block;
    const design: DesignDocument = {
      ...baseDesign,
      edges: [],
      blocks: Array.from({ length: 100 }, (_, i) => ({ ...block, id: `blk_${i}` })),
    };
    const start = performance.now();
    buildCostRows(design, estimate(design, catalog));
    const elapsed = performance.now() - start;
    console.info(`recálculo com 100 blocos: ${elapsed.toFixed(1)} ms`);
    expect(elapsed).toBeLessThan(100);
  });
});
