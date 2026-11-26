import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../../test/axe';
import { MARKERS, splitMarkers } from '../model/document';
import { privacyPolicy } from '../model/privacy';
import { termsOfUse } from '../model/terms';
import { PrivacyPage } from './PrivacyPage';
import { TermsPage } from './TermsPage';

function renderAt(path: string) {
  const Page = path === '/privacidade' ? PrivacyPage : TermsPage;
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Page />
    </MemoryRouter>,
  );
}

const pages = [
  ['/privacidade', privacyPolicy],
  ['/termos', termsOfUse],
] as const;

describe.each(pages)('%s', (path, doc) => {
  it('tem h1 único, índice com âncoras e uma seção por item', () => {
    const { container } = renderAt(path);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    const toc = screen.getByRole('navigation', { name: 'Nesta página' });
    for (const s of doc.sections) {
      expect(within(toc).getByRole('link', { name: s.heading })).toHaveAttribute(
        'href',
        `#${s.id}`,
      );
      expect(container.querySelector(`h2#${s.id}`)).toHaveTextContent(s.heading);
    }
  });

  it('define o título da aba e o restaura ao sair', () => {
    document.title = 'antes';
    const { unmount } = renderAt(path);
    expect(document.title).toBe(`${doc.title} · AWS Cost Playground`);
    unmount();
    expect(document.title).toBe('antes');
  });

  it('avisa que é rascunho, tem rodapé com links legais e não tem violação de acessibilidade', async () => {
    const { container } = renderAt(path);
    expect(screen.getByRole('status')).toHaveTextContent('Rascunho');
    const legal = screen.getByRole('navigation', { name: 'Informações legais' });
    expect(within(legal).getByRole('link', { name: 'Privacidade' })).toHaveAttribute(
      'href',
      '/privacidade',
    );
    await expectNoAxeViolations(container);
  });

  it('destaca os marcadores a preencher como texto', () => {
    const { container } = renderAt(path);
    const marks = container.querySelectorAll('mark');
    expect(marks.length).toBeGreaterThan(0);
    for (const m of marks) expect(m.textContent).toMatch(/^\[.+\]$/);
  });
});

describe('conteúdo exigido pela Issue #59', () => {
  const text = (doc: typeof privacyPolicy) => JSON.stringify(doc.sections);

  it('a política declara dado, hospedagem, Anthropic, retenção, exclusão e contato', () => {
    const t = text(privacyPolicy);
    for (const needle of [
      'e-mail',
      'us-east-1',
      'Anthropic',
      '7 dias',
      'exclusão na página Conta',
      MARKERS.contact,
      'Não coloque dado pessoal',
    ])
      expect(t).toContain(needle);
  });

  it('os termos declaram estimativa sem cotação oficial, sem garantia e sem dado pessoal na carga', () => {
    const t = text(termsOfUse);
    for (const needle of ['não uma cotação oficial', 'sem garantia', 'Não inclua dado pessoal'])
      expect(t).toContain(needle);
  });
});

describe('splitMarkers', () => {
  it('separa marcadores e preserva o texto', () => {
    expect(splitMarkers('a [X] b')).toEqual([
      { text: 'a ', marker: false },
      { text: '[X]', marker: true },
      { text: ' b', marker: false },
    ]);
  });
});
