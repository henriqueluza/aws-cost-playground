import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { parseCss, readRepoFile } from '../../test/css';
import { Button, IconButton } from './Button';

const css = () => parseCss(readRepoFile('web/src/shared/ui/Button.module.css'));

describe('Button', () => {
  it('é type="button" por padrão, para não enviar formulário sem querer', () => {
    render(<Button>Salvar</Button>);
    expect(screen.getByRole('button', { name: 'Salvar' })).toHaveAttribute('type', 'button');
  });

  it('aceita type="submit"', () => {
    render(<Button type="submit">Enviar</Button>);
    expect(screen.getByRole('button', { name: 'Enviar' })).toHaveAttribute('type', 'submit');
  });

  it('recebe foco por Tab e dispara com Enter e com Espaço', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Salvar</Button>);
    await user.tab();
    expect(screen.getByRole('button', { name: 'Salvar' })).toHaveFocus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('desabilitado fica fora da ordem de Tab e não dispara', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Salvar
      </Button>,
    );
    await user.tab();
    await user.keyboard('{Enter}');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it.each(['primary', 'secondary', 'tertiary', 'destructive'] as const)(
    'variante %s não tem violações de acessibilidade, habilitada ou não',
    async (variant) => {
      const { container } = render(
        <>
          <Button variant={variant}>Ação</Button>
          <Button variant={variant} disabled>
            Ação desabilitada
          </Button>
        </>,
      );
      await expectNoAxeViolations(container);
    },
  );

  it('mostra o texto como texto, nunca como HTML', () => {
    render(<Button>{'<img src=x onerror=alert(1)>'}</Button>);
    expect(screen.getByRole('button').querySelector('img')).toBeNull();
  });
});

describe('IconButton', () => {
  const icon = (
    <svg viewBox="0 0 16 16">
      <path d="M2 2h12v12H2z" />
    </svg>
  );

  it('usa o aria-label como nome e como tooltip, e esconde o ícone', () => {
    render(<IconButton aria-label="Apagar bloco">{icon}</IconButton>);
    const button = screen.getByRole('button', { name: 'Apagar bloco' });
    expect(button).toHaveAttribute('title', 'Apagar bloco');
    expect(button.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it('exige aria-label em tempo de compilação', () => {
    // @ts-expect-error sem aria-label o botão de ícone não tem nome
    const semNome = <IconButton>{icon}</IconButton>;
    expect(semNome).toBeDefined();
  });

  it('é operável por teclado', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <IconButton aria-label="Apagar bloco" onClick={onClick}>
        {icon}
      </IconButton>,
    );
    await user.tab();
    expect(screen.getByRole('button', { name: 'Apagar bloco' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('não tem violações de acessibilidade', async () => {
    const { container } = render(
      <>
        <IconButton aria-label="Apagar bloco">{icon}</IconButton>
        <IconButton aria-label="Duplicar bloco" disabled>
          {icon}
        </IconButton>
      </>,
    );
    await expectNoAxeViolations(container);
  });
});

describe('Button.module.css', () => {
  it('tem a altura do controle e o raio de controle', () => {
    expect(css()['.button']).toMatchObject({
      height: 'var(--control-height)',
      'border-radius': 'var(--radius-control)',
      'font-weight': 'var(--fw-medium)',
    });
  });

  it('o botão de ícone mede 32 × 32 (altura e largura do controle)', () => {
    expect(css()['.icon']).toMatchObject({ width: 'var(--control-height)' });
    expect(css()['.button']?.['height']).toBe('var(--control-height)');
  });

  it('o terciário tem sublinhado permanente que engrossa no hover', () => {
    const c = css();
    expect(c['.tertiary']).toMatchObject({
      'text-decoration-line': 'underline',
      'text-decoration-thickness': 'var(--border-width)',
      'text-underline-offset': 'var(--focus-offset)',
    });
    expect(c['@media (hover: hover) .tertiary:hover:not(:disabled)']).toMatchObject({
      'text-decoration-thickness': 'var(--focus-width)',
    });
  });

  it('o primário é tinta cheia e escurece no hover', () => {
    expect(css()['.primary']).toMatchObject({
      'background-color': 'var(--primary)',
      color: 'var(--primary-ink)',
    });
    expect(css()['@media (hover: hover) .primary:hover:not(:disabled)']).toMatchObject({
      'background-color': 'var(--primary-hover)',
    });
  });

  it('o secundário é folha com borda de controle e vai a --raised no hover', () => {
    expect(css()['.secondary']).toMatchObject({
      'background-color': 'var(--surface)',
      'border-color': 'var(--control)',
      color: 'var(--text)',
    });
    expect(
      css()[
        '@media (hover: hover) .secondary:hover:not(:disabled), .destructive:hover:not(:disabled)'
      ],
    ).toMatchObject({ 'background-color': 'var(--raised)' });
  });

  it('o destrutivo usa --negative no contorno e no texto', () => {
    expect(css()['.destructive']).toMatchObject({
      'border-color': 'var(--negative)',
      color: 'var(--negative)',
    });
  });

  it('o desabilitado troca fundo, borda e texto, não só a opacidade', () => {
    const disabled = css()['.button:disabled'];
    expect(disabled).toMatchObject({
      'background-color': 'var(--raised)',
      'border-color': 'var(--border)',
      color: 'var(--faint)',
      cursor: 'not-allowed',
    });
    expect(disabled).not.toHaveProperty('opacity');
  });

  it('pressionado escala 0,97 em --t-press', () => {
    expect(css()['.button:active:not(:disabled)']).toMatchObject({ transform: 'scale(0.97)' });
    expect(css()['.button']?.['transition']).toContain('transform var(--t-press)');
  });

  it('não remove o anel de foco', () => {
    for (const decls of Object.values(css())) {
      expect(decls['outline']).toBeUndefined();
    }
  });

  it('só usa tokens: nenhum hex nem px literal', () => {
    for (const decls of Object.values(css())) {
      for (const value of Object.values(decls)) expect(value).not.toMatch(/#|\d\s*px\b/);
    }
  });
});
