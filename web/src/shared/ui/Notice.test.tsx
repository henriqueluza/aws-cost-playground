import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { parseCss, readRepoFile } from '../../test/css';
import { Button } from './Button';
import { Notice, type NoticeTone } from './Notice';
import styles from './Notice.module.css';

const css = () => parseCss(readRepoFile('web/src/shared/ui/Notice.module.css'));
// Classe ausente no módulo vira um nome que não existe, para o toHaveClass não passar por acaso.
const cls = (key: string) => styles[key] ?? `sem-${key}`;
const message = 'O catálogo de preços tem mais de 30 dias.';
const tones: [NoticeTone, string, string | null][] = [
  ['negative', 'alert', 'Erro'],
  ['warning', 'status', 'Atenção'],
  ['neutral', 'note', null],
];
const all = () => tones.map(([tone]) => <Notice key={tone} tone={tone} message={tone} />);

describe('Notice', () => {
  it.each(tones)('%s tem o papel %s, com a mensagem em parágrafo', (tone, role) => {
    render(<Notice tone={tone} message={message} />);
    const root = screen.getByRole(role);
    expect(within(root).getByText(message).tagName).toBe('P');
    expect(root).toHaveClass(cls('notice'), cls(tone));
  });

  it('alert só para erro: aviso e neutro juntos não produzem alert', () => {
    render(all().slice(1));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a cor nunca é o único canal: texto, ícone de forma própria e nome', () => {
    render(all());
    for (const [, role, icon] of tones) {
      const root = screen.getByRole(role);
      if (icon) expect(within(root).getByRole('img', { name: icon })).toBeInTheDocument();
      else expect(within(root).queryByRole('img')).toBeNull();
    }
    expect(screen.getByRole('note').querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    const shapes = tones.map(([, role]) => screen.getByRole(role).querySelector('svg')?.innerHTML);
    expect(new Set(shapes).size).toBe(3);
  });

  it('mostra a mensagem como texto, nunca como HTML', () => {
    render(<Notice tone="negative" message={'<b>x</b>'} />);
    const root = screen.getByRole('alert');
    expect(root).toHaveTextContent('<b>x</b>');
    expect(root.querySelector('b')).toBeNull();
  });

  it('não rouba o foco nem é parada de Tab: o Tab vai direto ao botão', async () => {
    const user = userEvent.setup();
    render([...all(), <Button key="b">Tentar de novo</Button>]);
    expect(document.body).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toHaveFocus();
  });

  it('não tem violações de acessibilidade com os três tons juntos', async () => {
    const { container } = render(all());
    await expectNoAxeViolations(container);
  });
});

const expected = parseCss(`
  .notice { border: var(--border-width) solid transparent; border-radius: var(--radius-chip);
    font-size: var(--fs-body); line-height: var(--lh-body) }
  .negative { background-color: var(--pill-negative-bg); color: var(--pill-negative-ink) }
  .warning { background-color: var(--pill-warning-bg); color: var(--pill-warning-ink);
    border-color: var(--pill-warning-border) }
  .neutral { background-color: var(--pill-neutral-bg); color: var(--pill-neutral-ink) }
`);
describe('Notice.module.css', () => {
  it.each(Object.entries(expected))('%s segue o DESIGN.md (par da pílula do tom)', (sel, decls) => {
    expect(css()[sel]).toMatchObject(decls);
  });

  // Foco visível: o anel de 2px em --focus é o :focus-visible global (base.test.ts); aqui nada o apaga.
  it('só usa tokens e não declara outline: nenhum hex nem px literal', () => {
    const decls = Object.values(css());
    for (const value of decls.flatMap(Object.values)) expect(value).not.toMatch(/#|\d\s*px\b/);
    expect(decls.flatMap(Object.keys).filter((p) => p.startsWith('outline'))).toEqual([]);
  });
});
