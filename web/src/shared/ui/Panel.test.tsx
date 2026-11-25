import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { parseCss, readRepoFile } from '../../test/css';
import { Button } from './Button';
import { Panel } from './Panel';

const css = () => parseCss(readRepoFile('web/src/shared/ui/Panel.module.css'));

describe('Panel', () => {
  it('é uma região rotulada pelo título, que é um heading', () => {
    render(<Panel title="Custo por bloco">US$ 84,30</Panel>);
    const region = screen.getByRole('region', { name: 'Custo por bloco' });
    expect(region).toHaveTextContent('US$ 84,30');
    expect(screen.getByRole('heading', { name: 'Custo por bloco', level: 2 })).toBeInTheDocument();
  });

  it('aceita outro nível de heading', () => {
    render(
      <Panel title="Uso" headingLevel={3}>
        x
      </Panel>,
    );
    expect(screen.getByRole('heading', { name: 'Uso', level: 3 })).toBeInTheDocument();
  });

  it('dois painéis têm regiões com nomes distintos', () => {
    render(
      <>
        <Panel title="Fixo">a</Panel>
        <Panel title="Variável">b</Panel>
      </>,
    );
    expect(screen.getByRole('region', { name: 'Fixo' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Variável' })).toBeInTheDocument();
  });

  it('mostra o título como texto, nunca como HTML', () => {
    render(<Panel title={'<b>x</b>'}>y</Panel>);
    expect(screen.getByRole('heading').querySelector('b')).toBeNull();
  });

  it('o conteúdo focável dentro do painel é alcançado pelo teclado', async () => {
    const user = userEvent.setup();
    render(
      <Panel title="Ações">
        <Button>Baixar o JSON</Button>
        <Button variant="secondary">Copiar</Button>
      </Panel>,
    );
    await user.tab();
    expect(screen.getByRole('button', { name: 'Baixar o JSON' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Copiar' })).toHaveFocus();
  });

  it('não tem violações de acessibilidade, com e sem controles dentro', async () => {
    const { container } = render(
      <>
        <Panel title="Custo">US$ 84,30</Panel>
        <Panel title="Ações">
          <Button>Baixar o JSON</Button>
        </Panel>
      </>,
    );
    await expectNoAxeViolations(container);
  });
});

describe('Panel.module.css', () => {
  it('usa algarismos tabulares em todo o painel', () => {
    expect(css()['.panel']).toMatchObject({ 'font-variant-numeric': 'tabular-nums' });
  });

  it('a folha usa surface, borda, raio de cartão e padding de cartão', () => {
    expect(css()['.panel']).toMatchObject({
      'background-color': 'var(--surface)',
      'border-radius': 'var(--radius-card)',
      padding: 'var(--card-pad)',
    });
  });

  it('o título é Section: 16/24, peso 600', () => {
    expect(css()['.title']).toMatchObject({
      'font-size': 'var(--fs-section)',
      'line-height': 'var(--lh-section)',
      'font-weight': 'var(--fw-semibold)',
    });
  });

  it('só usa tokens: nenhum hex nem px literal', () => {
    for (const decls of Object.values(css())) {
      for (const value of Object.values(decls)) expect(value).not.toMatch(/#|\d\s*px\b/);
    }
  });
});
