import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { parseCss, readRepoFile } from '../../test/css';
import { Button } from './Button';
import { EmptyState } from './EmptyState';

const css = () => parseCss(readRepoFile('web/src/shared/ui/EmptyState.module.css'));

const renderEmpty = (onClick = vi.fn(), headingLevel?: 2 | 3 | 4) =>
  render(
    <EmptyState
      title="Nenhum bloco"
      description="Abra um template para começar."
      action={<Button onClick={onClick}>Abrir o template</Button>}
      headingLevel={headingLevel}
    />,
  );

describe('EmptyState', () => {
  it('junta título (h3 por padrão), frase e ação no mesmo contêiner', () => {
    const { container } = renderEmpty();
    const box = container.firstElementChild;
    const heading = screen.getByRole('heading', { name: 'Nenhum bloco', level: 3 });
    expect(box).toContainElement(heading);
    expect(box).toContainElement(screen.getByText('Abra um template para começar.'));
    expect(box).toContainElement(screen.getByRole('button', { name: 'Abrir o template' }));
  });

  it.each([2, 4] as const)('aceita heading de nível %i', (level) => {
    renderEmpty(vi.fn(), level);
    expect(screen.getByRole('heading', { name: 'Nenhum bloco', level })).toBeInTheDocument();
  });

  it('mostra título e frase como texto, nunca como HTML', () => {
    const { container } = render(
      <EmptyState title={'<b>x</b>'} description={'<i>y</i>'} action={<Button>Ok</Button>} />,
    );
    expect(screen.getByRole('heading', { name: '<b>x</b>' })).toBeInTheDocument();
    expect(screen.getByText('<i>y</i>')).toBeInTheDocument();
    expect(container.querySelector('b, i')).toBeNull();
  });

  it('a ação é alcançada pelo Tab e acionada pelo Enter', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    renderEmpty(onClick);
    await user.tab();
    expect(screen.getByRole('button', { name: 'Abrir o template' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('não tem violações de acessibilidade com a ação dentro', async () => {
    const { container } = renderEmpty();
    await expectNoAxeViolations(container);
  });
});

describe('EmptyState.module.css', () => {
  it('o contorno é tracejado de 1px em --control, com raio de cartão', () => {
    expect(css()['.empty']).toMatchObject({
      border: 'var(--border-width) dashed var(--control)',
      'border-radius': 'var(--radius-card)',
    });
  });

  it('o título é Body, peso 600, e a frase usa --muted', () => {
    expect(css()['.title']).toMatchObject({
      'font-size': 'var(--fs-body)',
      'line-height': 'var(--lh-body)',
      'font-weight': 'var(--fw-semibold)',
    });
    expect(css()['.description']).toMatchObject({ color: 'var(--muted)' });
  });

  // Foco visível: o anel de 2px em --focus é o :focus-visible global (base.test.ts); aqui nada o apaga.
  it('só usa tokens e não mexe no outline: nenhum hex, px literal nem outline', () => {
    for (const decls of Object.values(css())) {
      for (const value of Object.values(decls)) expect(value).not.toMatch(/#|\d\s*px\b/);
      expect(Object.keys(decls).filter((prop) => prop.startsWith('outline'))).toEqual([]);
    }
  });
});
